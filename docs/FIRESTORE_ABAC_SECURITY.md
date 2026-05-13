# Firestore Attribute-Based Access Control (ABAC) Implementation

## Overview

This document describes the fine-grained, attribute-based access control (ABAC) implementation for Firestore that provides multi-tenant isolation and prevents data leakage between farm/organization accounts.

## Security Model

### Core Principles

1. **Multi-Tenant Isolation**: All user data is scoped to an `organizationId` field
2. **Fail-Closed Design**: Access is denied by default unless explicitly granted
3. **Custom Claims Priority**: Auth token custom claims are checked first (no extra Firestore read)
4. **Immutable Organization**: Users cannot change their `organizationId` after creation
5. **Role-Based + Attribute-Based**: Combines role checks with organization membership validation

### Key Security Features

#### 1. Organization-Based Data Isolation

Every document that contains user-generated or sensitive data includes an `organizationId` field:

```javascript
{
  "userId": "user123",
  "organizationId": "farm_abc",  // Required for multi-tenant isolation
  "content": "...",
  // other fields
}
```

#### 2. Custom Claims Integration

The rules prioritize custom claims from the Firebase Auth token:

```javascript
// Token structure (set by backend)
{
  "uid": "user123",
  "role": "farmer",
  "organizationId": "farm_abc"
}
```

This approach:
- **Reduces Firestore reads** (no need to fetch user profile for every check)
- **Improves performance** (token claims are already in memory)
- **Maintains consistency** (claims are set by trusted backend)

#### 3. Granular Access Control

Each collection has specific rules:

| Collection | Read Access | Write Access | Organization Scoped |
|------------|-------------|--------------|---------------------|
| `users` | Self + Same Org + Admin | Self only | Yes |
| `posts` | Same Org + Admin | Self (own org) | Yes |
| `comments` | Same Org + Admin | Self (own org) | Yes |
| `activities` | Self + Admin | Self only | Yes |
| `yield_history` | Self + Expert + Admin | Self only | Yes |
| `reports` | Same Org + Expert + Admin | Expert + Admin | Yes |
| `marketplace` | Public | Vendor + Admin | Yes (for filtering) |
| `feedback` | Admin only | Any authenticated | Yes (for auditing) |
| `chats` | Sender + Recipient + Admin | Sender only | Yes |
| `organizations` | Members + Admin | Admin only | N/A |

## Implementation Guide

### Step 1: Set Custom Claims (Backend)

Update your Firebase Admin SDK code to set custom claims when users sign up or their role/organization changes:

```python
# main.py or auth service
from firebase_admin import auth

def set_user_claims(uid: str, role: str, organization_id: str):
    """Set custom claims on user's auth token."""
    auth.set_custom_user_claims(uid, {
        'role': role,
        'organizationId': organization_id
    })
    
    # Also update Firestore profile for fallback
    db_firestore.collection('users').document(uid).set({
        'role': role,
        'organizationId': organization_id,
        'updatedAt': firestore.SERVER_TIMESTAMP
    }, merge=True)

# Example: During user registration
@app.post("/api/auth/register")
async def register_user(request: RegisterRequest):
    # Create Firebase user
    user = auth.create_user(
        email=request.email,
        password=request.password
    )
    
    # Assign to organization (from invite code, domain, or admin assignment)
    org_id = determine_organization(request)
    
    # Set custom claims
    set_user_claims(user.uid, 'farmer', org_id)
    
    return {"uid": user.uid, "organizationId": org_id}
```

### Step 2: Update Frontend to Include organizationId

Modify your frontend code to include `organizationId` in all document writes:

```javascript
// Before (vulnerable)
await addDoc(collection(db, "posts"), {
  userId: currentUser.uid,
  content: postContent,
  createdAt: serverTimestamp()
});

// After (secure)
const userDoc = await getDoc(doc(db, "users", currentUser.uid));
const organizationId = userDoc.data()?.organizationId;

await addDoc(collection(db, "posts"), {
  userId: currentUser.uid,
  organizationId: organizationId,  // Required for ABAC
  content: postContent,
  createdAt: serverTimestamp()
});
```

**Better approach**: Create a helper function:

```javascript
// frontend/lib/firestore-helpers.js
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';

let cachedOrgId = null;

export async function getCurrentUserOrgId() {
  if (cachedOrgId) return cachedOrgId;
  
  const user = auth.currentUser;
  if (!user) throw new Error('User not authenticated');
  
  // Try to get from token claims first
  const token = await user.getIdTokenResult();
  if (token.claims.organizationId) {
    cachedOrgId = token.claims.organizationId;
    return cachedOrgId;
  }
  
  // Fallback to Firestore
  const userDoc = await getDoc(doc(db, 'users', user.uid));
  cachedOrgId = userDoc.data()?.organizationId;
  return cachedOrgId;
}

export async function createDocWithOrg(collectionRef, data) {
  const orgId = await getCurrentUserOrgId();
  return addDoc(collectionRef, {
    ...data,
    organizationId: orgId,
    userId: auth.currentUser.uid
  });
}

// Clear cache on auth state change
auth.onAuthStateChanged(() => {
  cachedOrgId = null;
});
```

### Step 3: Migrate Existing Data

Run a migration script to add `organizationId` to existing documents:

```python
# migration_add_org_id.py
from firebase_admin import firestore
import firebase_admin

if not firebase_admin._apps:
    firebase_admin.initialize_app()

db = firestore.client()

def migrate_collection(collection_name: str, default_org_id: str = None):
    """Add organizationId to all documents in a collection."""
    collection_ref = db.collection(collection_name)
    docs = collection_ref.stream()
    
    batch = db.batch()
    count = 0
    
    for doc in docs:
        data = doc.to_dict()
        
        # Skip if already has organizationId
        if 'organizationId' in data:
            continue
        
        # Determine org ID based on userId
        org_id = default_org_id
        if 'userId' in data:
            user_doc = db.collection('users').document(data['userId']).get()
            if user_doc.exists:
                org_id = user_doc.to_dict().get('organizationId', default_org_id)
        
        if org_id:
            batch.update(doc.reference, {'organizationId': org_id})
            count += 1
            
            # Commit in batches of 500
            if count % 500 == 0:
                batch.commit()
                batch = db.batch()
                print(f"Migrated {count} documents in {collection_name}")
    
    # Commit remaining
    if count % 500 != 0:
        batch.commit()
    
    print(f"Migration complete for {collection_name}: {count} documents updated")

# Run migrations
if __name__ == "__main__":
    collections_to_migrate = [
        'posts',
        'comments',
        'activities',
        'yield_history',
        'feedback',
        'reports',
        'marketplace'
    ]
    
    # Use a default org for orphaned data
    DEFAULT_ORG = "legacy_org_001"
    
    for collection in collections_to_migrate:
        print(f"\nMigrating {collection}...")
        migrate_collection(collection, DEFAULT_ORG)
    
    print("\n✅ All migrations complete!")
```

### Step 4: Deploy Firestore Rules

```bash
# Test rules locally first
firebase emulators:start --only firestore

# Deploy to production
firebase deploy --only firestore:rules
```

### Step 5: Verify Security

Run security tests to ensure rules work correctly:

```javascript
// tests/firestore-security.test.js
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';

describe('Firestore Security Rules', () => {
  test('User cannot read posts from other organizations', async () => {
    const db = getFirestore('user1', { organizationId: 'org_a' });
    const postRef = doc(db, 'posts', 'post_from_org_b');
    
    await assertFails(getDoc(postRef));
  });
  
  test('User can read posts from their organization', async () => {
    const db = getFirestore('user1', { organizationId: 'org_a' });
    const postRef = doc(db, 'posts', 'post_from_org_a');
    
    await assertSucceeds(getDoc(postRef));
  });
  
  test('User cannot change organizationId on update', async () => {
    const db = getFirestore('user1', { organizationId: 'org_a' });
    const postRef = doc(db, 'posts', 'user1_post');
    
    await assertFails(updateDoc(postRef, {
      organizationId: 'org_b'  // Attempt to move to different org
    }));
  });
  
  test('Admin can read posts from all organizations', async () => {
    const db = getFirestore('admin1', { role: 'admin', organizationId: 'org_a' });
    const postRef = doc(db, 'posts', 'post_from_org_b');
    
    await assertSucceeds(getDoc(postRef));
  });
});
```

## Security Considerations

### Threat Model

| Threat | Mitigation |
|--------|------------|
| **Cross-tenant data access** | All reads check `organizationId` match |
| **Organization switching** | `organizationId` is immutable after creation |
| **Role escalation** | Users cannot modify their own `role` field |
| **Token manipulation** | Custom claims are cryptographically signed by Firebase |
| **Missing organizationId** | Rules reject documents without required `organizationId` |
| **Firestore unavailable** | Fail-closed: access denied if user profile cannot be fetched |

### Performance Optimization

1. **Custom Claims First**: Rules check `request.auth.token` before reading Firestore
2. **Cached Org ID**: Frontend caches `organizationId` to reduce reads
3. **Indexed Queries**: Ensure Firestore indexes exist for `organizationId` filters

```json
// firestore.indexes.json
{
  "indexes": [
    {
      "collectionGroup": "posts",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "organizationId", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "comments",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "organizationId", "order": "ASCENDING" },
        { "fieldPath": "postId", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "ASCENDING" }
      ]
    }
  ]
}
```

### Audit Logging

Enable Firestore audit logs to track access patterns:

```python
# Cloud Logging query
resource.type="firestore_database"
protoPayload.methodName="google.firestore.v1.Firestore.RunQuery"
protoPayload.authenticationInfo.principalEmail!=""
```

## Testing Checklist

- [ ] Users can only read data from their organization
- [ ] Users cannot modify `organizationId` after creation
- [ ] Users cannot escalate their `role`
- [ ] Admins can access all organizations
- [ ] Custom claims are properly set on user creation
- [ ] Frontend includes `organizationId` in all writes
- [ ] Existing data has been migrated
- [ ] Firestore indexes are deployed
- [ ] Security rules are deployed to production
- [ ] Audit logging is enabled

## Rollback Plan

If issues arise after deployment:

1. **Immediate**: Revert to previous rules version
   ```bash
   firebase deploy --only firestore:rules --version <previous-version>
   ```

2. **Temporary**: Add a feature flag to backend
   ```python
   ENABLE_ABAC = os.getenv("ENABLE_ABAC", "false") == "true"
   ```

3. **Gradual**: Roll out to organizations incrementally
   ```javascript
   function isABACEnabled() {
     let orgId = getOrgIdFromToken();
     return orgId in ['pilot_org_1', 'pilot_org_2'];
   }
   ```

## Support

For questions or issues:
- Review the [Firestore Security Rules documentation](https://firebase.google.com/docs/firestore/security/get-started)
- Check the [Firebase Admin SDK documentation](https://firebase.google.com/docs/admin/setup)
- File an issue in the project repository

## References

- [NIST ABAC Guide](https://csrc.nist.gov/publications/detail/sp/800-162/final)
- [Firebase Custom Claims](https://firebase.google.com/docs/auth/admin/custom-claims)
- [Firestore Security Rules Best Practices](https://firebase.google.com/docs/firestore/security/rules-conditions)
