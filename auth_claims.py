"""
Firebase Custom Claims Management

This module provides utilities for setting and managing custom claims on
Firebase Auth tokens. Custom claims are used to implement attribute-based
access control (ABAC) in Firestore security rules.

Custom claims are cryptographically signed by Firebase and cannot be
tampered with by clients, making them ideal for storing security-critical
attributes like role and organizationId.
"""

import logging
from typing import Optional, Dict, Any
from firebase_admin import auth as firebase_auth, firestore

logger = logging.getLogger(__name__)


class CustomClaimsManager:
    """Manages custom claims for Firebase Auth users."""
    
    # Valid roles in the system
    VALID_ROLES = {'farmer', 'expert', 'vendor', 'admin'}
    
    def __init__(self, db_client=None):
        """
        Initialize the custom claims manager.
        
        Args:
            db_client: Firestore client instance (optional, will use default if not provided)
        """
        self.db = db_client or firestore.client()
    
    def set_user_claims(
        self,
        uid: str,
        role: str,
        organization_id: Optional[str] = None,
        additional_claims: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Set custom claims on a user's auth token.
        
        This method sets both the auth token custom claims (for fast access in
        Firestore rules) and updates the user's Firestore profile (for fallback
        and admin queries).
        
        Args:
            uid: The user's Firebase UID
            role: The user's role (must be in VALID_ROLES)
            organization_id: The user's organization/farm ID (optional)
            additional_claims: Additional custom claims to set (optional)
            
        Returns:
            True if successful, False otherwise
            
        Raises:
            ValueError: If role is invalid
        """
        # Validate role
        if role not in self.VALID_ROLES:
            raise ValueError(
                f"Invalid role '{role}'. Must be one of: {', '.join(self.VALID_ROLES)}"
            )
        
        # Build claims dictionary
        claims = {
            'role': role,
        }
        
        if organization_id:
            claims['organizationId'] = organization_id
        
        if additional_claims:
            claims.update(additional_claims)
        
        try:
            # Set custom claims on auth token
            firebase_auth.set_custom_user_claims(uid, claims)
            logger.info(f"Set custom claims for user {uid}: role={role}, org={organization_id}")
            
            # Also update Firestore profile for fallback and queries
            self.db.collection('users').document(uid).set({
                'role': role,
                'organizationId': organization_id,
                'updatedAt': firestore.SERVER_TIMESTAMP
            }, merge=True)
            
            logger.info(f"Updated Firestore profile for user {uid}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to set custom claims for user {uid}: {e}")
            return False
    
    def get_user_claims(self, uid: str) -> Optional[Dict[str, Any]]:
        """
        Get the custom claims for a user.
        
        Args:
            uid: The user's Firebase UID
            
        Returns:
            Dictionary of custom claims, or None if user not found
        """
        try:
            user = firebase_auth.get_user(uid)
            return user.custom_claims or {}
        except Exception as e:
            logger.error(f"Failed to get custom claims for user {uid}: {e}")
            return None
    
    def update_user_role(self, uid: str, new_role: str) -> bool:
        """
        Update a user's role while preserving other claims.
        
        Args:
            uid: The user's Firebase UID
            new_role: The new role to assign
            
        Returns:
            True if successful, False otherwise
        """
        # Get existing claims
        existing_claims = self.get_user_claims(uid)
        if existing_claims is None:
            logger.error(f"Cannot update role: user {uid} not found")
            return False
        
        # Update role
        return self.set_user_claims(
            uid=uid,
            role=new_role,
            organization_id=existing_claims.get('organizationId'),
            additional_claims={
                k: v for k, v in existing_claims.items()
                if k not in ('role', 'organizationId')
            }
        )
    
    def update_user_organization(self, uid: str, new_org_id: str) -> bool:
        """
        Update a user's organization while preserving other claims.
        
        ⚠️  WARNING: This is a sensitive operation that moves a user between
        organizations. Only admins should be able to call this.
        
        Args:
            uid: The user's Firebase UID
            new_org_id: The new organization ID
            
        Returns:
            True if successful, False otherwise
        """
        # Get existing claims
        existing_claims = self.get_user_claims(uid)
        if existing_claims is None:
            logger.error(f"Cannot update organization: user {uid} not found")
            return False
        
        old_org_id = existing_claims.get('organizationId')
        logger.warning(
            f"Moving user {uid} from organization '{old_org_id}' to '{new_org_id}'"
        )
        
        # Update organization
        return self.set_user_claims(
            uid=uid,
            role=existing_claims.get('role', 'farmer'),
            organization_id=new_org_id,
            additional_claims={
                k: v for k, v in existing_claims.items()
                if k not in ('role', 'organizationId')
            }
        )
    
    def remove_user_claims(self, uid: str) -> bool:
        """
        Remove all custom claims from a user.
        
        Args:
            uid: The user's Firebase UID
            
        Returns:
            True if successful, False otherwise
        """
        try:
            firebase_auth.set_custom_user_claims(uid, None)
            logger.info(f"Removed custom claims for user {uid}")
            return True
        except Exception as e:
            logger.error(f"Failed to remove custom claims for user {uid}: {e}")
            return False
    
    def bulk_set_claims(
        self,
        users: list[tuple[str, str, Optional[str]]],
        batch_size: int = 100
    ) -> Dict[str, int]:
        """
        Set custom claims for multiple users in bulk.
        
        Args:
            users: List of tuples (uid, role, organization_id)
            batch_size: Number of users to process in each batch
            
        Returns:
            Dictionary with counts: {'success': N, 'failed': M}
        """
        stats = {'success': 0, 'failed': 0}
        
        for i in range(0, len(users), batch_size):
            batch = users[i:i + batch_size]
            logger.info(f"Processing batch {i//batch_size + 1} ({len(batch)} users)")
            
            for uid, role, org_id in batch:
                if self.set_user_claims(uid, role, org_id):
                    stats['success'] += 1
                else:
                    stats['failed'] += 1
        
        logger.info(
            f"Bulk claims update complete: {stats['success']} succeeded, "
            f"{stats['failed']} failed"
        )
        return stats
    
    def sync_claims_from_firestore(self, uid: str) -> bool:
        """
        Sync custom claims from the user's Firestore profile.
        
        This is useful when the Firestore profile has been updated but the
        auth token claims are stale.
        
        Args:
            uid: The user's Firebase UID
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # Get user profile from Firestore
            user_doc = self.db.collection('users').document(uid).get()
            if not user_doc.exists:
                logger.error(f"Cannot sync claims: user {uid} profile not found in Firestore")
                return False
            
            user_data = user_doc.to_dict()
            role = user_data.get('role', 'farmer')
            org_id = user_data.get('organizationId')
            
            # Set claims from Firestore data
            return self.set_user_claims(uid, role, org_id)
            
        except Exception as e:
            logger.error(f"Failed to sync claims for user {uid}: {e}")
            return False


# Global instance for convenience
_claims_manager = None


def get_claims_manager(db_client=None) -> CustomClaimsManager:
    """
    Get the global CustomClaimsManager instance.
    
    Args:
        db_client: Firestore client instance (optional)
        
    Returns:
        CustomClaimsManager instance
    """
    global _claims_manager
    if _claims_manager is None:
        _claims_manager = CustomClaimsManager(db_client)
    return _claims_manager


# Convenience functions for common operations

def set_user_claims(uid: str, role: str, organization_id: Optional[str] = None) -> bool:
    """Convenience function to set user claims."""
    return get_claims_manager().set_user_claims(uid, role, organization_id)


def update_user_role(uid: str, new_role: str) -> bool:
    """Convenience function to update user role."""
    return get_claims_manager().update_user_role(uid, new_role)


def update_user_organization(uid: str, new_org_id: str) -> bool:
    """Convenience function to update user organization."""
    return get_claims_manager().update_user_organization(uid, new_org_id)


def get_user_claims(uid: str) -> Optional[Dict[str, Any]]:
    """Convenience function to get user claims."""
    return get_claims_manager().get_user_claims(uid)
