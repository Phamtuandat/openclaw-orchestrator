# Context — iPhone Build/Deploy Commands

## Primary project (current)
- Decky (AnkiClone)
- Path: `/Volumes/Home_EX/Projects/Xcode/Projects/AnkiClone/Decky`
- Scheme: `Decky`
- Bundle ID: `com.PhamDat.Decky`

## Device
- iPhone name: `Iphone’s dat`
- Device ID: `00008030-001D34EA0A90802E`

## Standard flow
1) Build for device:
```bash
xcodebuild -project /Volumes/Home_EX/Projects/Xcode/Projects/AnkiClone/Decky/Decky.xcodeproj \
  -scheme Decky -configuration Debug \
  -destination 'id=00008030-001D34EA0A90802E' \
  -allowProvisioningUpdates build
```

2) Install app:
```bash
xcrun devicectl device install app --device 00008030-001D34EA0A90802E \
  /Users/datpham/Library/Developer/Xcode/DerivedData/Decky-aolfnupqzqfccfheuorxkauctysm/Build/Products/Debug-iphoneos/Decky.app
```

3) Launch app:
```bash
xcrun devicectl device process launch --device 00008030-001D34EA0A90802E com.PhamDat.Decky
```

## Troubleshooting quick notes
- If `CoreDeviceError 4000`: reconnect cable / trust prompt / rerun install.
- Verify connected devices:
```bash
xcrun xctrace list devices
```
