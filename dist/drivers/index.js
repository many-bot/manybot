import { whatsappDriver } from "./whatsapp/index.js";
import { PLATFORM } from "#config";
import { applyPatches } from "./patches/index.js";
applyPatches();
const DRIVERS = {
    whatsapp: whatsappDriver,
};
export function initializeSelectedDriver() {
    const driver = DRIVERS[PLATFORM];
    if (!driver) {
        throw new Error(`Unsupported platform/driver: ${PLATFORM}`);
    }
    return driver;
}
