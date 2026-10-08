import { DIRECT_BACKEND_ID, SDK_BACKEND_ID, type BackendFactory } from "./backend.js";
import { LeetCodeCN } from "./platform.js";
import { SdkBackend } from "./sdk-backend.js";

// SDK remains opt-in until real account judging is certified. Stored jobs always
// select their original adapter, independently of the current default.
export const createBackend: BackendFactory = (credentials, backendId) => {
    const selected = backendId ?? process.env.PI_LEETCODE_BACKEND ?? "direct";
    if (selected === "direct" || selected === DIRECT_BACKEND_ID) return new LeetCodeCN(credentials);
    if (selected === "sdk" || selected === SDK_BACKEND_ID) return new SdkBackend(credentials);
    throw new Error("未知 LeetCode 后端。PI_LEETCODE_BACKEND 仅支持 direct 或 sdk。");
};
