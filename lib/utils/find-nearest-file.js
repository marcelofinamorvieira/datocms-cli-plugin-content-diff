"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findNearestFile = findNearestFile;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
async function findNearestFile(fileName, directoryPath = (0, node_path_1.resolve)()) {
    try {
        const path = (0, node_path_1.join)(directoryPath, fileName);
        await (0, promises_1.access)(path);
        return path;
    }
    catch {
        const parentDirectoryPath = (0, node_path_1.dirname)(directoryPath);
        if (parentDirectoryPath === directoryPath) {
            throw new Error(`No "${fileName}" file found`);
        }
        return findNearestFile(fileName, parentDirectoryPath);
    }
}
