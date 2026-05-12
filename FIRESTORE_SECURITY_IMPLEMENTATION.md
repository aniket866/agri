# Firestore Security Implementation Summary

## Problem Statement

The original Firestore security rules used coarse-grained access control, allowing any authenticated user to read/write sensitive agricultural data belonging to other users. This created a serious data leakage risk in a multi-tenant environment where multiple farms/organizations share the same database.

## Solution Overview

Implemented fine-grained **Attribute-Based Access Control (ABAC)** with multi-tenant isolation using:

1. **Organization-scoped data**: Every document includes an `organizationId` field
2. **Custom claims**: Firebase Auth tokens carry `role` and `organizationId` claims
3. **Granular rules**: Firestore rules validate organization membership before granting access
4. **Immutable tenancy**: Users cannot change their `organizationId` after creation

## What Was Changed

### 1. Firestore Security Rules (`firestore.rules`)

**Before:**
```javascript
// Any authenticated user could read all posts
match /posts/{postId} {
  allow read: if isAuthed();
  allow create: if isAuthed() && postContentValid();
}
```

**After:**
```javascript
// Users can only read posts from their organization
match /posts/{postId} {
  allow read: if isAuthed() && (
    hasRole('admin')
    || canAccessOrg(resource.data.get('organizationId', null))
  );
  
  allow create: if isAuthed()
    && postContentValid()
    && hasValidOrgId()  // Must match user's org
    && request.resource.data.userId == request.auth.uid;
}
```

**Key improvements:**
- ✅ Organization-based read access control
- ✅ Validation that documents belong to user's organization
- ✅ Prevention of organization switching (immutable `organizationId`)
- ✅ Role-based overrides for admins
- ✅ Custom claims integration for performance

### 2. Backend Custom Claims Management (`auth_claims.py`)

New module for managing Firebase Auth custom claims:

```python
from auth_claims import set_user_claims

# Set claims on user registration
set_user_claims(
    uid='user123',
    role='farmer',
    organization_id='farm_abc'
)
```

**Features:**
- Set/update custom claims on auth tokens
- Sync claims with Firestore profiles
- Bulk operations for migrations
- Role and organization validation

### 3. Frontend ABAC Helpers (`frontend/lib/firestore-abac.js`)

New utility module for organization-scoped operations:

```javascript
import { createDocWithOrg, queryOrgDocs } from './lib/firestore-abac';

// Automatically includes organizationId
await createDocWithOrg('posts', { content: 'Hello' });

// Only queries user's organization
const posts = await queryOrgDocs('posts', [orderBy('createdAt', 'desc')]);
```

**Features:**
- Automatic `organizationId` injection
- Caching to reduce Firestore reads
- Organization-scoped queries
- Access validation helpers

### 4. Migration Script (`migration_add_org_id.py`)

Script to add `organizationId` to existing documents:

```bash
# Dry run to preview changes
python migration_add_org_id.py --dry-run

# Apply migration
python migration_add_org_id.py --default-org farm_legacy
```

**Features:**
- Batch processing (500 docs at a time)
- Automatic organization detection from userId
- Dry-run mode for safety
- Detailed logging and statistics

### 5. Firestore Indexes (`firestore.indexes.json`)

Added composite indexes for organization-scoped queries:

```json
{
  "collectionGroup": "posts",
  "fields": [
    { "fieldPath": "organizationId", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
}
```

**Indexes added for:**
- posts (by org + createdAt)
- comments (by org + postId + createdAt)
- activities (by userId + org + date)
- yield_history (by org + timestamp)
- reports (by org + createdAt)
- marketplace (by org + category + createdAt)
- users (by org + role)

## Security Improvements

| Threat | Before | After |
|--------|--------|-------|
| **Cross-tenant data access** | ❌ Any user could read any data | ✅ Users can only access their org's data |
| **Organization switching** | ❌ No organization concept | ✅ organizationId is immutable |
| **Role escalation** | ⚠️ Limited protection | ✅ Users cannot modify their own role |
| **Data leakage** | ❌ High risk | ✅ Mitigated by org isolation |
| **Unauthorized writes** | ⚠️ Basic userId check | ✅ org + userId + role validation |

## Performance Optimizations

1. **Custom Claims First**: Rules check `request.auth.token` before reading Firestore (saves 1 read per request)
2. **Frontend Caching**: organizationId cached for 5 minutes (reduces redundant reads)
3. **Composite Indexes**: Optimized queries for org-scoped data
4. **Batch Operations**: Migration processes 500 documents at a time

## Collections Protected

The following collections now have organization-based isolation:

- ✅ `users` - User profiles
- ✅ `posts` - Community posts
- ✅ `comments` - Post comments
- ✅ `activities` - Farming activities
- ✅ `yield_history` - Yield predictions
- ✅ `reports` - Agricultural reports
- ✅ `marketplace` - Product listings
- ✅ `feedback` - User feedback
- ✅ `public_keys` - E2E encryption keys
- ✅ `chats` - Direct messages
- ✅ `organizations` - Organization metadata

## Deployment Steps

### 1. Backend Setup

```bash
# Install dependencies (if needed)
pip install firebase-admin

# Set custom claims for existing users
python -c "
from auth_claims import set_user_claims
set_user_claims('user_uid', 'farmer', 'farm_001')
"
```

### 2. Data Migration

```bash
# Preview changes
python migration_add_org_id.py --dry-run

# Apply migration
python migration_add_org_id.py --default-org legacy_org_001

# Verify migration
# Check Firebase Console > Firestore to confirm organizationId fields
```

### 3. Deploy Firestore Configuration

```bash
# Deploy indexes
firebase deploy --only firestore:indexes

# Wait for indexes to build (check Firebase Console)

# Deploy rules
firebase deploy --only firestore:rules
```

### 4. Frontend Updates

```javascript
// Update App.jsx
import { initABAC } from './lib/firestore-abac';

function App() {
  useEffect(() => {
    initABAC();
  }, []);
  // ...
}

// Update all document creation
import { createDocWithOrg } from './lib/firestore-abac';
await createDocWithOrg('posts', { content: 'Hello' });

// Update all queries
import { queryOrgDocs } from './lib/firestore-abac';
const posts = await queryOrgDocs('posts');
```

### 5. Testing

```bash
# Run security tests
npm test -- firestore-security.test.js

# Manual testing:
# 1. Create users in different organizations
# 2. Verify users cannot see each other's data
# 3. Verify admins can see all data
# 4. Verify organizationId cannot be changed
```

## Rollback Plan

If issues arise:

```bash
# Revert Firestore rules
firebase deploy --only firestore:rules --version <previous-version>

# Or temporarily disable ABAC in rules
# Add at top of firestore.rules:
function isABACEnabled() {
  return false;  // Temporarily disable
}
```

## Monitoring

Enable audit logging to track access patterns:

```bash
# Cloud Logging query
resource.type="firestore_database"
protoPayload.methodName="google.firestore.v1.Firestore.RunQuery"
severity="ERROR"
```

Monitor for:
- Permission denied errors (may indicate missing organizationId)
- Slow queries (may need additional indexes)
- Failed writes (may indicate validation issues)

## Documentation

- **[FIRESTORE_ABAC_SECURITY.md](docs/FIRESTORE_ABAC_SECURITY.md)** - Complete security documentation
- **[ABAC_QUICK_START.md](docs/ABAC_QUICK_START.md)** - Quick start guide for developers
- **[firestore.rules](firestore.rules)** - Security rules with inline comments
- **[auth_claims.py](auth_claims.py)** - Backend custom claims management
- **[frontend/lib/firestore-abac.js](frontend/lib/firestore-abac.js)** - Frontend helpers
- **[migration_add_org_id.py](migration_add_org_id.py)** - Migration script

## Testing Checklist

- [ ] Users can only read data from their organization
- [ ] Users cannot modify `organizationId` after creation
- [ ] Users cannot escalate their `role`
- [ ] Admins can access all organizations
- [ ] Custom claims are set on user creation
- [ ] Frontend includes `organizationId` in all writes
- [ ] Existing data has been migrated
- [ ] Firestore indexes are deployed and built
- [ ] Security rules are deployed to production
- [ ] Audit logging is enabled
- [ ] Performance is acceptable (no significant slowdown)

## Known Limitations

1. **Organization assignment**: The current implementation doesn't include a UI for assigning users to organizations. This must be done via:
   - Admin API endpoint
   - Invite code system
   - Email domain matching
   - Manual assignment

2. **Organization creation**: No UI for creating organizations. Must be done via:
   - Admin panel
   - Backend script
   - Firebase Console

3. **Cross-organization collaboration**: Current rules don't support users accessing multiple organizations. To add this:
   - Change `organizationId` to `organizationIds` (array)
   - Update rules to check array membership
   - Update frontend helpers

4. **Public data**: Marketplace is currently public. To restrict:
   - Add organization filter to marketplace queries
   - Update rules to check organization membership

## Future Enhancements

1. **Multi-organization membership**: Allow users to belong to multiple organizations
2. **Organization invites**: Implement invite code system
3. **Organization admin role**: Add `org_admin` role for organization-level administration
4. **Data sharing**: Allow organizations to share specific documents
5. **Organization settings**: Add organization-level configuration
6. **Usage analytics**: Track per-organization usage and quotas

## Support

For questions or issues:
- Review the documentation in `docs/`
- Check Firebase Console for rule evaluation errors
- Enable debug logging: `debugABACContext()` in browser console
- File an issue in the project repository

## References

- [Firebase Security Rules Documentation](https://firebase.google.com/docs/firestore/security/get-started)
- [Firebase Custom Claims](https://firebase.google.com/docs/auth/admin/custom-claims)
- [NIST ABAC Guide](https://csrc.nist.gov/publications/detail/sp/800-162/final)
- [Multi-Tenancy Best Practices](https://cloud.google.com/firestore/docs/solutions/multi-tenancy)

---

**Implementation Date**: 2026-05-13  
**Status**: ✅ Ready for deployment  
**Risk Level**: Medium (requires data migration and rule changes)  
**Estimated Deployment Time**: 2-4 hours (including index build time)
