# Postman test scripts reference

- **Pre-request Script** (`listen: "prerequest"`): Runs before the request. Used on every idempotent POST to **auto-generate a new UUID** and set the collection variable `requestId`, so you don’t have to change it manually. You’ll see it in the **Pre-request Script** tab for: Create Business User, Update KYB, Submit KYB, Add External Wallet, Create Account (onramp/offramp), Create Onramp, Create Offramp, Create High-Value Request.
- **Test script** (`listen: "test"`): Runs after the response. Used to auto-save response IDs (userId, fileId, etc.) into collection variables. Shown in the **Tests** tab.

---

## Where to see them in Postman

1. Open the **BloxFi API** collection.
2. Expand a folder (e.g. **User**).
3. **Click a request** that has tests (e.g. **Create Business User**).
4. In the request panel, open the **Tests** tab (next to Params, Authorization, Headers, Body, Pre-request Script).

Only these requests have a test script; others (e.g. Health check, Get User) have no **Tests** tab content.

---

## Requests that have test scripts

| Folder  | Request name              | Variable saved     |
|---------|---------------------------|---------------------|
| Files   | Upload File               | `fileId`            |
| User    | Create Business User      | `userId`            |
| Wallets | Add External Wallet       | `walletId`          |
| Accounts| Create Account (onramp)   | `accountId`         |
| Onramps | Create Onramp             | `onrampId`          |
| Offramps| Create Offramp            | `offrampId`         |
| Limits  | Create High-Value Request | `highValueRequestId` |

---

## Scripts (copy-paste if Tests tab is empty)

### 1. Upload File → save `fileId`

```javascript
if (pm.response.code === 201 && pm.response.json().success && pm.response.json().data && pm.response.json().data.fileId) {
    pm.collectionVariables.set('fileId', pm.response.json().data.fileId);
    console.log('Saved fileId: ' + pm.response.json().data.fileId);
}
```

### 2. Create Business User → save `userId`

```javascript
if (pm.response.code === 201 && pm.response.json().success && pm.response.json().data && pm.response.json().data.id) {
    pm.collectionVariables.set('userId', pm.response.json().data.id);
    console.log('Saved userId: ' + pm.response.json().data.id);
}
```

### 3. Add External Wallet → save `walletId`

```javascript
if (pm.response.code === 201 && pm.response.json().success && pm.response.json().data && pm.response.json().data.id) {
    pm.collectionVariables.set('walletId', pm.response.json().data.id);
    console.log('Saved walletId: ' + pm.response.json().data.id);
}
```

### 4. Create Account (onramp) → save `accountId`

```javascript
if (pm.response.code === 200 && pm.response.json().success && pm.response.json().data && pm.response.json().data.id) {
    pm.collectionVariables.set('accountId', pm.response.json().data.id);
    console.log('Saved accountId: ' + pm.response.json().data.id);
}
```

### 5. Create Onramp → save `onrampId`

```javascript
var j = pm.response.json();
if (pm.response.code === 201 && j.success && j.data && j.data.transferDetails && j.data.transferDetails.id) {
    pm.collectionVariables.set('onrampId', j.data.transferDetails.id);
    console.log('Saved onrampId: ' + j.data.transferDetails.id);
}
```

### 6. Create Offramp → save `offrampId`

```javascript
var j = pm.response.json();
if (pm.response.code === 201 && j.success && j.data && j.data.transferDetails && j.data.transferDetails.id) {
    pm.collectionVariables.set('offrampId', j.data.transferDetails.id);
    console.log('Saved offrampId: ' + j.data.transferDetails.id);
}
```

### 7. Create High-Value Request → save `highValueRequestId`

```javascript
if (pm.response.code === 201 && pm.response.json().success && pm.response.json().data && pm.response.json().data.requestId) {
    pm.collectionVariables.set('highValueRequestId', pm.response.json().data.requestId);
    console.log('Saved highValueRequestId: ' + pm.response.json().data.requestId);
}
```

---

## If you still don’t see the Tests tab

- Make sure the **request** is selected (not the folder or the collection).
- Check the row of tabs: **Params | Authorization | Headers | Body | Pre-request Script | Tests**. Click **Tests**.
- If the collection was imported from an old copy, re-import `postman/api_bloxfi.postman_collection.json` and use the new collection.
- You can paste any script above into the **Tests** tab of the matching request and save the collection.

---

## Where they are in the JSON file

In `api_bloxfi.postman_collection.json`, each of the requests above has this shape:

```json
{
  "name": "Create Business User",
  "event": [
    {
      "listen": "test",
      "script": {
        "exec": [
          "if (pm.response.code === 201 && ...",
          "    pm.collectionVariables.set('userId', ...);",
          "..."
        ],
        "type": "text/javascript"
      }
    }
  ],
  "request": { ... }
}
```

Search the file for `"listen": "test"` to jump to each test script.
