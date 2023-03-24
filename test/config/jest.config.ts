import { cpus } from "os";

const cpuCount = cpus().length;
const maxConcurrency = cpuCount > 4 ? cpuCount - 2 : cpuCount;

// jest.config.js
module.exports = {
  preset: "ts-jest",
  globals: {
    "ts-jest": {
      diagnostics: {
        warnOnly: true,
      },
      isolatedModules: true,
    },
  },
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "../",
  transform: {
    "^.+\\.tsx?$": "ts-jest",
    "^.+\\.(t|j)s$": "babel-jest",
  },
  transformIgnorePatterns: [
    "/node_modules/(?!(axios|other-module-to-compile)/)",
  ],
  testEnvironment: "node",
  moduleNameMapper: {
    "@/(.*)": "<rootDir>/$1",
    "@test/(.*)": "<rootDir>/../test/$1",
    // axios: "axios/dist/node/axios.cjs",
  },
  setupFiles: ["<rootDir>/../test/config/jest-unhandleRejection.setup.ts"],
  setupFilesAfterEnv: ["jest-extended/all"],
  maxConcurrency,
  maxWorkers: maxConcurrency,
};
