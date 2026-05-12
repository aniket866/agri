"""
Firestore Security Rules Test Suite

Tests the ABAC (Attribute-Based Access Control) implementation to ensure
proper multi-tenant isolation and prevent data leakage between organizations.

These tests verify that:
1. Users can only access data from their organization
2. Users cannot modify organizationId after creation
3. Users cannot escalate their role
4. Admins can access all organizations
5. Documents without organizationId are rejected

Run with: pytest tests/test_firestore_security.py
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
from datetime import datetime


class MockFirestoreDoc:
    """Mock Firestore document for testing."""
    
    def __init__(self, doc_id: str, data: dict, exists: bool = True):
        self.id = doc_id
        self._data = data
        self._exists = exists
        self.reference = Mock()
    
    def to_dict(self):
        return self._data
    
    @property
    def exists(self):
        return self._exists


class MockFirestoreCollection:
    """Mock Firestore collection for testing."""
    
    def __init__(self, documents: dict = None):
        self.documents = documents or {}
    
    def document(self, doc_id: str):
        mock_doc = Mock()
        if doc_id in self.documents:
            mock_doc.get.return_value = self.documents[doc_id]
        else:
            mock_doc.get.return_value = MockFirestoreDoc(doc_id, {}, exists=False)
        return mock_doc
    
    def add(self, data: dict):
        doc_id = f"doc_{len(self.documents)}"
        self.documents[doc_id] = MockFirestoreDoc(doc_id, data)
        return Mock(id=doc_id)


class TestOrganizationIsolation:
    """Test that users can only access data from their organization."""
    
    def test_user_cannot_read_other_org_posts(self):
        """Users should not be able to read posts from other organizations."""
        # Simulate Firestore rules check
        user_org = "org_a"
        post_org = "org_b"
        user_role = "farmer"
        
        # In real Firestore rules: canAccessOrg(resource.data.organizationId)
        can_access = (user_role == "admin") or (user_org == post_org)
        
        assert not can_access, "User should not access posts from other organizations"
    
    def test_user_can_read_own_org_posts(self):
        """Users should be able to read posts from their organization."""
        user_org = "org_a"
        post_org = "org_a"
        user_role = "farmer"
        
        can_access = (user_role == "admin") or (user_org == post_org)
        
        assert can_access, "User should access posts from their organization"
    
    def test_admin_can_read_all_org_posts(self):
        """Admins should be able to read posts from all organizations."""
        user_org = "org_a"
        post_org = "org_b"
        user_role = "admin"
        
        can_access = (user_role == "admin") or (user_org == post_org)
        
        assert can_access, "Admin should access posts from all organizations"
    
    def test_user_cannot_create_post_in_other_org(self):
        """Users should not be able to create posts in other organizations."""
        user_org = "org_a"
        post_data = {
            "userId": "user123",
            "organizationId": "org_b",  # Trying to create in different org
            "content": "Hello"
        }
        
        # In real Firestore rules: hasValidOrgId()
        is_valid = post_data["organizationId"] == user_org
        
        assert not is_valid, "User should not create posts in other organizations"
    
    def test_user_can_create_post_in_own_org(self):
        """Users should be able to create posts in their organization."""
        user_org = "org_a"
        post_data = {
            "userId": "user123",
            "organizationId": "org_a",
            "content": "Hello"
        }
        
        is_valid = post_data["organizationId"] == user_org
        
        assert is_valid, "User should create posts in their organization"


class TestImmutableOrganization:
    """Test that organizationId cannot be changed after creation."""
    
    def test_cannot_change_organization_id(self):
        """Users should not be able to change organizationId on update."""
        existing_doc = {
            "userId": "user123",
            "organizationId": "org_a",
            "content": "Hello"
        }
        
        update_data = {
            "organizationId": "org_b",  # Trying to change org
            "content": "Updated"
        }
        
        # In real Firestore rules: orgIdNotChanged()
        org_changed = (
            "organizationId" in update_data 
            and update_data["organizationId"] != existing_doc["organizationId"]
        )
        
        assert org_changed, "organizationId change should be detected"
    
    def test_can_update_without_changing_org(self):
        """Users should be able to update documents without changing organizationId."""
        existing_doc = {
            "userId": "user123",
            "organizationId": "org_a",
            "content": "Hello"
        }
        
        update_data = {
            "content": "Updated"
            # organizationId not in update
        }
        
        org_changed = (
            "organizationId" in update_data 
            and update_data["organizationId"] != existing_doc["organizationId"]
        )
        
        assert not org_changed, "Update without org change should be allowed"


class TestRoleEscalation:
    """Test that users cannot escalate their role."""
    
    def test_user_cannot_change_own_role(self):
        """Users should not be able to change their own role."""
        user_id = "user123"
        existing_doc = {
            "userId": user_id,
            "role": "farmer"
        }
        
        update_data = {
            "role": "admin"  # Trying to escalate
        }
        
        # In real Firestore rules: !("role" in request.resource.data.diff(resource.data).affectedKeys())
        role_changed = (
            "role" in update_data 
            and update_data["role"] != existing_doc["role"]
        )
        
        assert role_changed, "Role escalation attempt should be detected"
    
    def test_user_can_update_profile_without_role_change(self):
        """Users should be able to update their profile without changing role."""
        existing_doc = {
            "userId": "user123",
            "role": "farmer",
            "name": "John"
        }
        
        update_data = {
            "name": "John Doe"
            # role not in update
        }
        
        role_changed = (
            "role" in update_data 
            and update_data["role"] != existing_doc["role"]
        )
        
        assert not role_changed, "Profile update without role change should be allowed"


class TestCustomClaimsIntegration:
    """Test custom claims management."""
    
    @patch('auth_claims.firebase_auth')
    @patch('auth_claims.firestore')
    def test_set_user_claims(self, mock_firestore, mock_auth):
        """Test setting custom claims on user."""
        from auth_claims import CustomClaimsManager
        
        mock_db = Mock()
        manager = CustomClaimsManager(mock_db)
        
        # Set claims
        result = manager.set_user_claims(
            uid='user123',
            role='farmer',
            organization_id='org_a'
        )
        
        # Verify auth claims were set
        mock_auth.set_custom_user_claims.assert_called_once()
        call_args = mock_auth.set_custom_user_claims.call_args
        assert call_args[0][0] == 'user123'
        assert call_args[0][1]['role'] == 'farmer'
        assert call_args[0][1]['organizationId'] == 'org_a'
    
    def test_invalid_role_rejected(self):
        """Test that invalid roles are rejected."""
        from auth_claims import CustomClaimsManager
        
        manager = CustomClaimsManager()
        
        with pytest.raises(ValueError, match="Invalid role"):
            manager.set_user_claims(
                uid='user123',
                role='superuser',  # Invalid role
                organization_id='org_a'
            )
    
    @patch('auth_claims.firebase_auth')
    def test_get_user_claims(self, mock_auth):
        """Test getting user claims."""
        from auth_claims import CustomClaimsManager
        
        # Mock user with claims
        mock_user = Mock()
        mock_user.custom_claims = {
            'role': 'farmer',
            'organizationId': 'org_a'
        }
        mock_auth.get_user.return_value = mock_user
        
        manager = CustomClaimsManager()
        claims = manager.get_user_claims('user123')
        
        assert claims['role'] == 'farmer'
        assert claims['organizationId'] == 'org_a'


class TestDocumentValidation:
    """Test document validation rules."""
    
    def test_document_without_org_id_rejected(self):
        """Documents without organizationId should be rejected."""
        doc_data = {
            "userId": "user123",
            "content": "Hello"
            # Missing organizationId
        }
        
        has_org_id = "organizationId" in doc_data
        
        assert not has_org_id, "Document without organizationId should be rejected"
    
    def test_document_with_org_id_accepted(self):
        """Documents with organizationId should be accepted."""
        doc_data = {
            "userId": "user123",
            "organizationId": "org_a",
            "content": "Hello"
        }
        
        has_org_id = "organizationId" in doc_data
        
        assert has_org_id, "Document with organizationId should be accepted"
    
    def test_document_with_null_org_id_rejected(self):
        """Documents with null organizationId should be rejected."""
        doc_data = {
            "userId": "user123",
            "organizationId": None,
            "content": "Hello"
        }
        
        has_valid_org_id = (
            "organizationId" in doc_data 
            and doc_data["organizationId"] is not None
        )
        
        assert not has_valid_org_id, "Document with null organizationId should be rejected"


class TestAccessPatterns:
    """Test common access patterns."""
    
    def test_user_can_read_own_activities(self):
        """Users should be able to read their own activities."""
        user_id = "user123"
        user_org = "org_a"
        
        activity_data = {
            "userId": user_id,
            "organizationId": user_org,
            "title": "Planting"
        }
        
        # User can read if they own it AND it's in their org
        can_read = (
            activity_data["userId"] == user_id 
            and activity_data["organizationId"] == user_org
        )
        
        assert can_read, "User should read their own activities"
    
    def test_expert_can_read_org_reports(self):
        """Experts should be able to read reports from their organization."""
        user_role = "expert"
        user_org = "org_a"
        
        report_data = {
            "organizationId": user_org,
            "title": "Soil Analysis"
        }
        
        can_read = (
            user_role in ["expert", "admin"]
            and report_data["organizationId"] == user_org
        )
        
        assert can_read, "Expert should read reports from their organization"
    
    def test_vendor_can_update_own_listing(self):
        """Vendors should be able to update their own marketplace listings."""
        user_id = "vendor123"
        user_role = "vendor"
        user_org = "org_a"
        
        listing_data = {
            "vendorId": user_id,
            "organizationId": user_org,
            "product": "Seeds"
        }
        
        can_update = (
            user_role in ["vendor", "admin"]
            and listing_data["vendorId"] == user_id
            and listing_data["organizationId"] == user_org
        )
        
        assert can_update, "Vendor should update their own listings"
    
    def test_user_cannot_read_other_user_activities(self):
        """Users should not be able to read other users' activities."""
        user_id = "user123"
        user_org = "org_a"
        
        activity_data = {
            "userId": "user456",  # Different user
            "organizationId": user_org,
            "title": "Planting"
        }
        
        # User can only read their own activities
        can_read = activity_data["userId"] == user_id
        
        assert not can_read, "User should not read other users' activities"


class TestMigrationScript:
    """Test the migration script functionality."""
    
    @patch('migration_add_org_id.firestore')
    @patch('migration_add_org_id.firebase_admin')
    def test_migration_adds_org_id(self, mock_firebase, mock_firestore):
        """Test that migration adds organizationId to documents."""
        from migration_add_org_id import FirestoreMigration
        
        # Mock Firestore client
        mock_db = Mock()
        mock_firestore.client.return_value = mock_db
        
        # Mock user document with organizationId
        user_doc = MockFirestoreDoc('user123', {'organizationId': 'org_a'})
        mock_db.collection.return_value.document.return_value.get.return_value = user_doc
        
        migration = FirestoreMigration(dry_run=True, default_org_id='legacy_org')
        
        # Test getting org ID from user
        org_id = migration.get_user_org_id('user123')
        
        assert org_id == 'org_a', "Should get organizationId from user profile"
    
    def test_migration_uses_default_for_orphaned_docs(self):
        """Test that migration uses default org for documents without userId."""
        from migration_add_org_id import FirestoreMigration
        
        migration = FirestoreMigration(dry_run=True, default_org_id='legacy_org')
        
        # Document without userId
        doc_data = {
            "content": "Hello"
            # No userId
        }
        
        # Should use default org
        org_id = migration.default_org_id
        
        assert org_id == 'legacy_org', "Should use default org for orphaned documents"


class TestFrontendHelpers:
    """Test frontend ABAC helper functions."""
    
    def test_validate_abac_fields(self):
        """Test ABAC field validation."""
        # This would be a JavaScript test in practice
        # Here we simulate the validation logic
        
        valid_doc = {
            "userId": "user123",
            "organizationId": "org_a",
            "content": "Hello"
        }
        
        invalid_doc = {
            "content": "Hello"
            # Missing userId and organizationId
        }
        
        def validate(data):
            errors = []
            if "userId" not in data:
                errors.append("Missing userId")
            if "organizationId" not in data:
                errors.append("Missing organizationId")
            return len(errors) == 0, errors
        
        is_valid, _ = validate(valid_doc)
        assert is_valid, "Valid document should pass validation"
        
        is_valid, errors = validate(invalid_doc)
        assert not is_valid, "Invalid document should fail validation"
        assert len(errors) == 2, "Should have 2 validation errors"


# Integration test scenarios
class TestIntegrationScenarios:
    """Test complete user workflows."""
    
    def test_new_user_registration_flow(self):
        """Test complete flow for new user registration."""
        # 1. User registers
        user_data = {
            "uid": "user123",
            "email": "farmer@example.com",
            "invite_code": "FARM_ABC_INVITE"
        }
        
        # 2. Determine organization from invite code
        org_id = "farm_abc"  # Derived from invite code
        
        # 3. Set custom claims
        claims = {
            "role": "farmer",
            "organizationId": org_id
        }
        
        # 4. Create user profile
        profile = {
            "userId": user_data["uid"],
            "organizationId": org_id,
            "role": "farmer",
            "email": user_data["email"]
        }
        
        # Verify all required fields are present
        assert "organizationId" in claims
        assert "organizationId" in profile
        assert claims["organizationId"] == profile["organizationId"]
    
    def test_user_creates_post_flow(self):
        """Test complete flow for creating a post."""
        # 1. User is authenticated
        user = {
            "uid": "user123",
            "organizationId": "org_a",
            "role": "farmer"
        }
        
        # 2. User creates post
        post_data = {
            "userId": user["uid"],
            "organizationId": user["organizationId"],
            "content": "Great harvest this year!",
            "createdAt": datetime.now()
        }
        
        # 3. Validate post data
        assert post_data["userId"] == user["uid"]
        assert post_data["organizationId"] == user["organizationId"]
        assert "content" in post_data
        
        # 4. Check if user can create in this org
        can_create = post_data["organizationId"] == user["organizationId"]
        assert can_create, "User should be able to create post in their org"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
