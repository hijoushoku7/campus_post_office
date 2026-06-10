import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// Next.js 16 では `next lint` が廃止されたため ESLint フラット設定に移行。
// `next/core-web-vitals` + `next/typescript` 相当の構成。
/** @type {import('eslint').Linter.Config[]} */
const config = [...nextCoreWebVitals, ...nextTypescript];

export default config;
