import assert from "node:assert/strict";
import { describe, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("MF-111: Staff Scanner Camera Selection Dropdown & Kiosk Front Camera Default", () => {
  it("verifies Staff ScannerPage source code includes facing mode dropdown and localStorage persistence", () => {
    const staffScannerPath = path.resolve(
      __dirname,
      "../apps/staff-dashboard/src/features/qr-scanner/components/ScannerPage.tsx"
    );
    const content = fs.readFileSync(staffScannerPath, "utf-8");

    // Must have localStorage key
    assert(
      content.includes("desk_atlas_staff_camera_facing"),
      "ScannerPage should reference localStorage key 'desk_atlas_staff_camera_facing'"
    );

    // Must have cameraFacingMode state supporting environment and user
    assert(
      content.includes("cameraFacingMode"),
      "ScannerPage should have cameraFacingMode state"
    );

    // Must dynamically pass facingMode to getUserMedia
    assert(
      content.includes("facingMode: cameraFacingMode"),
      "ScannerPage should pass facingMode: cameraFacingMode to getUserMedia"
    );

    // Must contain select dropdown with Back and Front camera options
    assert(
      content.includes("staff-camera-select") || content.includes("Camera:"),
      "ScannerPage should contain camera selector dropdown"
    );
    assert(
      content.includes('value="environment"') && content.includes('value="user"'),
      "ScannerPage should include 'environment' (back) and 'user' (front) camera options"
    );

    // Must stop stream and update state when changing camera
    assert(
      content.includes("handleCameraChange") || content.includes("setCameraFacingMode"),
      "ScannerPage should handle camera selection change"
    );
  });

  it("verifies Kiosk Scanner source code strictly enforces front camera (facingMode: 'user')", () => {
    const kioskScannerPath = path.resolve(
      __dirname,
      "../apps/kiosk/src/app/features/qr-scanner/KioskScanner.tsx"
    );
    const content = fs.readFileSync(kioskScannerPath, "utf-8");

    // Must request user facingMode
    assert(
      content.includes('facingMode: "user"'),
      "KioskScanner should request facingMode: 'user' for front-facing stationary scanning"
    );

    // Must not request environment facingMode
    assert(
      !content.includes('facingMode: "environment"'),
      "KioskScanner should not request facingMode: 'environment'"
    );
  });

  it("simulates staff scanner camera selection logic and localStorage persistence", () => {
    const storage: Record<string, string> = {};
    const mockLocalStorage = {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, val: string) => {
        storage[key] = val;
      },
    };

    // Helper imitating initial facing mode determination
    const getInitialFacingMode = (ls: typeof mockLocalStorage): "environment" | "user" => {
      const saved = ls.getItem("desk_atlas_staff_camera_facing");
      if (saved === "user" || saved === "environment") return saved;
      return "environment";
    };

    // Default when empty
    assert.equal(getInitialFacingMode(mockLocalStorage), "environment");

    // User switches to front camera
    mockLocalStorage.setItem("desk_atlas_staff_camera_facing", "user");
    assert.equal(getInitialFacingMode(mockLocalStorage), "user");

    // User switches back to environment
    mockLocalStorage.setItem("desk_atlas_staff_camera_facing", "environment");
    assert.equal(getInitialFacingMode(mockLocalStorage), "environment");
  });

  it("verifies Staff ScannerPage source code supports device enumeration and selection on laptop/pc", () => {
    const staffScannerPath = path.resolve(
      __dirname,
      "../apps/staff-dashboard/src/features/qr-scanner/components/ScannerPage.tsx"
    );
    const content = fs.readFileSync(staffScannerPath, "utf-8");

    // Must enumerate video devices
    assert(
      content.includes("enumerateDevices"),
      "ScannerPage should call enumerateDevices to detect available cameras"
    );

    // Must store selected deviceId for laptop/pc
    assert(
      content.includes("desk_atlas_staff_camera_device_id"),
      "ScannerPage should reference localStorage key 'desk_atlas_staff_camera_device_id'"
    );

    // Must handle laptop/PC device change
    assert(
      content.includes("handleDeviceChange") && content.includes("selectedDeviceId"),
      "ScannerPage should handle detected camera device selection"
    );

    // Must check device type (mobile/tablet vs laptop/pc)
    assert(
      content.includes("checkIsMobileOrTablet") || content.includes("isMobileOrTablet"),
      "ScannerPage should distinguish mobile/tablet vs laptop/PC devices"
    );
  });

  it("simulates laptop/pc camera detection and deviceId selection logic", () => {
    const storage: Record<string, string> = {};
    const mockLocalStorage = {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, val: string) => {
        storage[key] = val;
      },
    };

    const mockDetectedCameras = [
      { deviceId: "cam-int-1", label: "Integrated Webcam" },
      { deviceId: "cam-ext-2", label: "Logitech HD Pro C920" },
    ];

    // Helper imitating initial device selection
    const getInitialDeviceId = (ls: typeof mockLocalStorage, detected: typeof mockDetectedCameras): string => {
      const saved = ls.getItem("desk_atlas_staff_camera_device_id");
      if (saved && detected.some(c => c.deviceId === saved)) return saved;
      return detected[0]?.deviceId ?? "";
    };

    // Default to first detected camera when nothing in localStorage
    assert.equal(getInitialDeviceId(mockLocalStorage, mockDetectedCameras), "cam-int-1");

    // Staff member selects external webcam on laptop/pc
    mockLocalStorage.setItem("desk_atlas_staff_camera_device_id", "cam-ext-2");
    assert.equal(getInitialDeviceId(mockLocalStorage, mockDetectedCameras), "cam-ext-2");

    // If external webcam disconnected, gracefully fallback to first detected camera
    const singleCameraList = [{ deviceId: "cam-int-1", label: "Integrated Webcam" }];
    assert.equal(getInitialDeviceId(mockLocalStorage, singleCameraList), "cam-int-1");
  });
});
