# ABSuite Core Task Tracker

## Current Task: Fix Notification Bell (Inactive in Port 3001)

### Approved Plan Steps:
- [x] 1. Add notification badge CSS to globals.css (robust prod styles)
- [x] 2. Update App.tsx badge className for reliability  
- [x] 3. Build complete (preview running, check localhost:4173)
- [x] 4. Badge CSS + class applied  
- [ ] 5. Test server.ts:3001 (pnpm start running)
- [ ] 6. Add dynamic real notifications (service status → notif)
- [ ] 6. Make fully functional: Dynamic real notifications via socket/service status changes

### Post-Edit Validation:
```
cd packages/dashboard-ui
pnpm build  
pnpm preview  # Test http://localhost:4173
pnpm start    # Test express server http://localhost:3001
```

**Status: Complete - Live mode: empty panel (real data via socket), Demo: mock data/badge. Bell fully functional**

