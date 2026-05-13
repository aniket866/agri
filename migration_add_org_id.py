#!/usr/bin/env python3
"""
Firestore Migration Script: Add organizationId to Existing Documents

This script adds the organizationId field to all existing documents in
collections that require multi-tenant isolation. It determines the
organizationId based on the document's userId field.

Usage:
    python migration_add_org_id.py [--dry-run] [--default-org ORG_ID]

Options:
    --dry-run       Show what would be changed without making changes
    --default-org   Default organization ID for orphaned documents (default: legacy_org_001)
    --collections   Comma-separated list of collections to migrate (default: all)

Example:
    python migration_add_org_id.py --dry-run
    python migration_add_org_id.py --default-org farm_legacy
    python migration_add_org_id.py --collections posts,comments
"""

import argparse
import sys
import logging
from typing import Optional, List
from datetime import datetime

import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud.firestore_v1 import FieldFilter

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class FirestoreMigration:
    """Handles migration of organizationId field to Firestore documents."""
    
    # Collections that need organizationId for multi-tenant isolation
    COLLECTIONS_TO_MIGRATE = [
        'posts',
        'comments',
        'activities',
        'yield_history',
        'feedback',
        'reports',
        'marketplace',
        'public_keys',
    ]
    
    def __init__(self, dry_run: bool = False, default_org_id: str = "legacy_org_001"):
        """
        Initialize the migration.
        
        Args:
            dry_run: If True, only show what would be changed
            default_org_id: Default organization ID for orphaned documents
        """
        self.dry_run = dry_run
        self.default_org_id = default_org_id
        self.db = None
        self.stats = {
            'total_processed': 0,
            'total_updated': 0,
            'total_skipped': 0,
            'total_errors': 0,
            'by_collection': {}
        }
        
    def initialize_firebase(self):
        """Initialize Firebase Admin SDK."""
        if not firebase_admin._apps:
            try:
                # Try to initialize with default credentials
                firebase_admin.initialize_app()
                logger.info("✓ Firebase Admin initialized with default credentials")
            except Exception as e:
                logger.error(f"✗ Failed to initialize Firebase Admin: {e}")
                logger.info("Make sure GOOGLE_APPLICATION_CREDENTIALS is set or running in GCP environment")
                sys.exit(1)
        
        self.db = firestore.client()
        logger.info("✓ Firestore client connected")
    
    def get_user_org_id(self, user_id: str) -> Optional[str]:
        """
        Get the organizationId for a user from their profile.
        
        Args:
            user_id: The user's UID
            
        Returns:
            The user's organizationId or None if not found
        """
        try:
            user_doc = self.db.collection('users').document(user_id).get()
            if user_doc.exists:
                return user_doc.to_dict().get('organizationId')
        except Exception as e:
            logger.warning(f"Could not fetch user {user_id}: {e}")
        return None
    
    def migrate_document(self, doc_ref, doc_data: dict, collection_name: str) -> bool:
        """
        Migrate a single document by adding organizationId.
        
        Args:
            doc_ref: Firestore document reference
            doc_data: Document data dictionary
            collection_name: Name of the collection
            
        Returns:
            True if document was updated, False if skipped
        """
        # Skip if already has organizationId
        if 'organizationId' in doc_data:
            logger.debug(f"Skipping {doc_ref.id}: already has organizationId")
            return False
        
        # Determine organizationId
        org_id = None
        
        # Try to get from userId field
        if 'userId' in doc_data:
            org_id = self.get_user_org_id(doc_data['userId'])
        
        # Try to get from vendorId field (for marketplace)
        elif 'vendorId' in doc_data:
            org_id = self.get_user_org_id(doc_data['vendorId'])
        
        # Use default if still not found
        if not org_id:
            org_id = self.default_org_id
            logger.warning(
                f"Using default org '{org_id}' for {collection_name}/{doc_ref.id} "
                f"(no userId found or user has no org)"
            )
        
        # Update document
        if self.dry_run:
            logger.info(f"[DRY RUN] Would update {collection_name}/{doc_ref.id} with organizationId={org_id}")
        else:
            try:
                doc_ref.update({
                    'organizationId': org_id,
                    'migratedAt': firestore.SERVER_TIMESTAMP
                })
                logger.info(f"✓ Updated {collection_name}/{doc_ref.id} with organizationId={org_id}")
            except Exception as e:
                logger.error(f"✗ Failed to update {collection_name}/{doc_ref.id}: {e}")
                self.stats['total_errors'] += 1
                return False
        
        return True
    
    def migrate_collection(self, collection_name: str) -> dict:
        """
        Migrate all documents in a collection.
        
        Args:
            collection_name: Name of the collection to migrate
            
        Returns:
            Dictionary with migration statistics for this collection
        """
        logger.info(f"\n{'='*60}")
        logger.info(f"Migrating collection: {collection_name}")
        logger.info(f"{'='*60}")
        
        collection_stats = {
            'processed': 0,
            'updated': 0,
            'skipped': 0,
            'errors': 0
        }
        
        try:
            # Query documents without organizationId
            # Note: This requires a composite index if you want to filter by missing field
            # For simplicity, we'll fetch all documents and check in code
            collection_ref = self.db.collection(collection_name)
            docs = collection_ref.stream()
            
            batch = self.db.batch()
            batch_count = 0
            BATCH_SIZE = 500
            
            for doc in docs:
                collection_stats['processed'] += 1
                doc_data = doc.to_dict()
                
                # Skip if already has organizationId
                if 'organizationId' in doc_data:
                    collection_stats['skipped'] += 1
                    continue
                
                # Determine organizationId
                org_id = None
                
                if 'userId' in doc_data:
                    org_id = self.get_user_org_id(doc_data['userId'])
                elif 'vendorId' in doc_data:
                    org_id = self.get_user_org_id(doc_data['vendorId'])
                
                if not org_id:
                    org_id = self.default_org_id
                    logger.warning(
                        f"Using default org '{org_id}' for {collection_name}/{doc.id}"
                    )
                
                # Add to batch
                if not self.dry_run:
                    batch.update(doc.reference, {
                        'organizationId': org_id,
                        'migratedAt': firestore.SERVER_TIMESTAMP
                    })
                    batch_count += 1
                    collection_stats['updated'] += 1
                    
                    # Commit batch when it reaches BATCH_SIZE
                    if batch_count >= BATCH_SIZE:
                        batch.commit()
                        logger.info(f"  Committed batch of {batch_count} documents")
                        batch = self.db.batch()
                        batch_count = 0
                else:
                    logger.info(
                        f"[DRY RUN] Would update {collection_name}/{doc.id} "
                        f"with organizationId={org_id}"
                    )
                    collection_stats['updated'] += 1
            
            # Commit remaining documents in batch
            if batch_count > 0 and not self.dry_run:
                batch.commit()
                logger.info(f"  Committed final batch of {batch_count} documents")
            
        except Exception as e:
            logger.error(f"✗ Error migrating collection {collection_name}: {e}")
            collection_stats['errors'] += 1
        
        # Log collection summary
        logger.info(f"\nCollection '{collection_name}' summary:")
        logger.info(f"  Processed: {collection_stats['processed']}")
        logger.info(f"  Updated:   {collection_stats['updated']}")
        logger.info(f"  Skipped:   {collection_stats['skipped']}")
        logger.info(f"  Errors:    {collection_stats['errors']}")
        
        return collection_stats
    
    def run(self, collections: Optional[List[str]] = None):
        """
        Run the migration for specified collections.
        
        Args:
            collections: List of collection names to migrate, or None for all
        """
        start_time = datetime.now()
        
        logger.info("\n" + "="*60)
        logger.info("FIRESTORE ORGANIZATION ID MIGRATION")
        logger.info("="*60)
        logger.info(f"Mode: {'DRY RUN' if self.dry_run else 'LIVE'}")
        logger.info(f"Default Organization ID: {self.default_org_id}")
        logger.info(f"Start Time: {start_time.strftime('%Y-%m-%d %H:%M:%S')}")
        
        if self.dry_run:
            logger.warning("\n⚠️  DRY RUN MODE - No changes will be made ⚠️\n")
        
        # Initialize Firebase
        self.initialize_firebase()
        
        # Determine which collections to migrate
        collections_to_process = collections or self.COLLECTIONS_TO_MIGRATE
        
        # Migrate each collection
        for collection_name in collections_to_process:
            collection_stats = self.migrate_collection(collection_name)
            
            # Update overall stats
            self.stats['total_processed'] += collection_stats['processed']
            self.stats['total_updated'] += collection_stats['updated']
            self.stats['total_skipped'] += collection_stats['skipped']
            self.stats['total_errors'] += collection_stats['errors']
            self.stats['by_collection'][collection_name] = collection_stats
        
        # Print final summary
        end_time = datetime.now()
        duration = end_time - start_time
        
        logger.info("\n" + "="*60)
        logger.info("MIGRATION COMPLETE")
        logger.info("="*60)
        logger.info(f"Total Processed: {self.stats['total_processed']}")
        logger.info(f"Total Updated:   {self.stats['total_updated']}")
        logger.info(f"Total Skipped:   {self.stats['total_skipped']}")
        logger.info(f"Total Errors:    {self.stats['total_errors']}")
        logger.info(f"Duration:        {duration}")
        logger.info(f"End Time:        {end_time.strftime('%Y-%m-%d %H:%M:%S')}")
        
        if self.dry_run:
            logger.info("\n✓ Dry run completed successfully")
            logger.info("Run without --dry-run to apply changes")
        elif self.stats['total_errors'] == 0:
            logger.info("\n✓ Migration completed successfully!")
        else:
            logger.warning(f"\n⚠️  Migration completed with {self.stats['total_errors']} errors")
            logger.warning("Review the logs above for details")


def main():
    """Main entry point for the migration script."""
    parser = argparse.ArgumentParser(
        description='Migrate Firestore documents to include organizationId field',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would be changed without making changes'
    )
    
    parser.add_argument(
        '--default-org',
        type=str,
        default='legacy_org_001',
        help='Default organization ID for orphaned documents (default: legacy_org_001)'
    )
    
    parser.add_argument(
        '--collections',
        type=str,
        help='Comma-separated list of collections to migrate (default: all)'
    )
    
    args = parser.parse_args()
    
    # Parse collections list
    collections = None
    if args.collections:
        collections = [c.strip() for c in args.collections.split(',')]
    
    # Run migration
    migration = FirestoreMigration(
        dry_run=args.dry_run,
        default_org_id=args.default_org
    )
    
    try:
        migration.run(collections=collections)
    except KeyboardInterrupt:
        logger.warning("\n\n⚠️  Migration interrupted by user")
        sys.exit(1)
    except Exception as e:
        logger.error(f"\n\n✗ Migration failed with error: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
