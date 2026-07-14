# Public API Report

Public API source: `packages/hrt-contract/src/index.ts`

```ts
export * from "./types";
export * from "./fixtures/frames";
export * from "./validators/frameValidator";
```

Exported declaration count: 66

## Export Surface

```text
packages/hrt-contract/src/validators/frameValidator.ts:19:export interface ValidationResult {
packages/hrt-contract/src/validators/frameValidator.ts:129:export function validateFrame(value: unknown): ValidationResult {
packages/hrt-contract/src/validators/frameValidator.ts:155:export function validateCommandRequestPayload(value: unknown): ValidationResult {
packages/hrt-contract/src/validators/frameValidator.ts:179:export function validateProviderRegistrationPayload(value: unknown): ValidationResult {
packages/hrt-contract/src/validators/frameValidator.ts:226:export function validateHandshakeRequestPayload(value: unknown): ValidationResult {
packages/hrt-contract/src/validators/frameValidator.ts:248:export function evaluateCompatibility(
packages/hrt-contract/src/validators/frameValidator.ts:284:export function validateCompatibilityResultPayload(value: unknown): ValidationResult {
packages/hrt-contract/src/validators/frameValidator.ts:303:export function validateHandshakeResponsePayload(value: unknown): ValidationResult {
packages/hrt-contract/src/validators/frameValidator.ts:318:export function validateCommandResultPayload(value: unknown): ValidationResult {
packages/hrt-contract/src/validators/frameValidator.ts:334:export function validateScannerEventPayload(value: unknown): ValidationResult {
packages/hrt-contract/src/validators/frameValidator.ts:355:export function validateCustomerDisplaySnapshotPayload(value: unknown): ValidationResult {
packages/hrt-contract/src/validators/frameValidator.ts:378:export function validateHealthSnapshotPayload(value: unknown): ValidationResult {
packages/hrt-contract/src/validators/frameValidator.ts:402:export function validateDiagnosticPayload(value: unknown): ValidationResult {
packages/hrt-contract/src/validators/frameValidator.ts:423:export function assertValidFrame<TPayload>(frame: HrtFrame<TPayload>): void {
packages/hrt-contract/src/validators/frameValidator.ts:430:export function assertValidCommandRequest(payload: HrtCommandRequestPayload): void {
packages/hrt-contract/src/validators/frameValidator.ts:437:export function assertValidCommandResult(payload: HrtCommandResultPayload): void {
packages/hrt-contract/src/validators/frameValidator.ts:444:export function assertValidProviderRegistration(payload: HrtProviderRegistrationPayload): void {
packages/hrt-contract/src/validators/frameValidator.ts:451:export function assertValidHandshakeRequest(payload: HrtHandshakeRequestPayload): void {
packages/hrt-contract/src/validators/frameValidator.ts:458:export function assertValidHandshakeResponse(payload: HrtHandshakeResponsePayload): void {
packages/hrt-contract/src/validators/frameValidator.ts:465:export function assertValidScannerEvent(payload: HrtDeviceEventPayload): void {
packages/hrt-contract/src/validators/frameValidator.ts:472:export function assertValidCustomerDisplaySnapshot(payload: HrtCustomerDisplaySnapshotPayload): void {
packages/hrt-contract/src/validators/frameValidator.ts:479:export function assertValidHealthSnapshot(payload: HrtHealthSnapshotPayload): void {
packages/hrt-contract/src/validators/frameValidator.ts:486:export function assertValidDiagnostic(payload: HrtDiagnosticPayload): void {
packages/hrt-contract/src/index.ts:1:export * from "./types";
packages/hrt-contract/src/index.ts:2:export * from "./fixtures/frames";
packages/hrt-contract/src/index.ts:3:export * from "./validators/frameValidator";
packages/hrt-contract/src/fixtures/frames.ts:16:export const providerRegistrationFixture: HrtFrame<HrtProviderRegistrationPayload> = {
packages/hrt-contract/src/fixtures/frames.ts:72:export const handshakeRequestFixture: HrtFrame<HrtHandshakeRequestPayload> = {
packages/hrt-contract/src/fixtures/frames.ts:93:export const handshakeResponseFixture: HrtFrame<HrtHandshakeResponsePayload> = {
packages/hrt-contract/src/fixtures/frames.ts:116:export const printReceiptCommandFixture: HrtFrame<HrtCommandRequestPayload> = {
packages/hrt-contract/src/fixtures/frames.ts:139:export const succeededCommandResultFixture: HrtFrame<HrtCommandResultPayload> = {
packages/hrt-contract/src/fixtures/frames.ts:154:export const unknownCommandResultFixture: HrtFrame<HrtCommandResultPayload> = {
packages/hrt-contract/src/fixtures/frames.ts:171:export const scannerEventFixture: HrtFrame<HrtDeviceEventPayload> = {
packages/hrt-contract/src/fixtures/frames.ts:198:export const customerDisplaySnapshotFixture: HrtFrame<HrtCustomerDisplaySnapshotPayload> = {
packages/hrt-contract/src/fixtures/frames.ts:228:export const healthSnapshotFixture: HrtFrame<HrtHealthSnapshotPayload> = {
packages/hrt-contract/src/fixtures/frames.ts:249:export const diagnosticFixture: HrtFrame<HrtDiagnosticPayload> = {
packages/hrt-contract/src/fixtures/frames.ts:269:export const invalidMissingCorrelationFrameFixture: Omit<HrtFrame<HrtDiagnosticPayload>, "correlationId"> = {
packages/hrt-contract/src/types.ts:1:export const HRT_CONTRACT_VERSION = "1.0.0";
packages/hrt-contract/src/types.ts:3:export const HRT_PROVIDER_COMPATIBILITY_MATRIX = {
packages/hrt-contract/src/types.ts:14:export type HrtDeviceKind = "PRINTER" | "SCANNER" | "CUSTOMER_DISPLAY";
packages/hrt-contract/src/types.ts:16:export type HrtMessageType =
packages/hrt-contract/src/types.ts:32:export type HrtCommandOutcome =
packages/hrt-contract/src/types.ts:40:export type HrtEffectBoundary = "NOT_CROSSED" | "CROSSING_UNKNOWN" | "CROSSED";
packages/hrt-contract/src/types.ts:42:export type HrtCapability =
packages/hrt-contract/src/types.ts:48:export type HrtCommandFamily = "printer" | "scanner" | "customer_display";
packages/hrt-contract/src/types.ts:50:export type HrtEventFamily = "scanner" | "health" | "diagnostics";
packages/hrt-contract/src/types.ts:52:export type HrtProviderState =
packages/hrt-contract/src/types.ts:61:export type HrtDeviceHealth = "UNKNOWN" | "ONLINE" | "DEGRADED" | "OFFLINE";
packages/hrt-contract/src/types.ts:63:export type HrtProviderHealth = "UNKNOWN" | "STARTING" | "READY" | "DEGRADED" | "DISCONNECTED" | "SHUTDOWN";
packages/hrt-contract/src/types.ts:65:export type HrtCompatibilityStatus = "COMPATIBLE" | "INCOMPATIBLE";
packages/hrt-contract/src/types.ts:67:export type HrtCompatibilityReason =
packages/hrt-contract/src/types.ts:73:export type HrtRejectionReason =
packages/hrt-contract/src/types.ts:82:export type HrtDiagnosticSeverity = "INFO" | "WARN" | "ERROR";
packages/hrt-contract/src/types.ts:84:export type HrtJsonValue =
packages/hrt-contract/src/types.ts:92:export interface HrtFrame<TPayload = HrtJsonValue> {
packages/hrt-contract/src/types.ts:102:export interface HrtCapabilityDescriptor {
packages/hrt-contract/src/types.ts:109:export interface HrtProviderRegistrationPayload {
packages/hrt-contract/src/types.ts:127:export interface HrtHandshakeRequestPayload {
packages/hrt-contract/src/types.ts:135:export interface HrtCompatibilityMatrixEntry {
packages/hrt-contract/src/types.ts:142:export interface HrtCompatibilityResultPayload {
packages/hrt-contract/src/types.ts:153:export interface HrtHandshakeResponsePayload {
packages/hrt-contract/src/types.ts:160:export interface HrtProviderLifecyclePayload {
packages/hrt-contract/src/types.ts:177:export interface HrtDeviceRef {
packages/hrt-contract/src/types.ts:183:export interface HrtCommandRequestPayload {
packages/hrt-contract/src/types.ts:196:export interface HrtCommandResultPayload {
packages/hrt-contract/src/types.ts:205:export interface HrtDeviceEventPayload {
packages/hrt-contract/src/types.ts:218:export interface HrtCustomerDisplaySnapshotPayload {
packages/hrt-contract/src/types.ts:233:export interface HrtHealthSnapshotPayload {
packages/hrt-contract/src/types.ts:244:export interface HrtDiagnosticPayload {
```

## Public

- Types and constants exported from `types.ts`.
- Fixtures exported from `fixtures/frames.ts`.
- Validators and compatibility utilities exported from `validators/frameValidator.ts`.
- JSON schemas are packaged under `src/schemas` as schema artifacts; they are public files, not TypeScript named exports.

## Internal

- Validator helper functions such as local record checks, scope checks, and semver comparison are internal because they are not exported.
- Schema implementation details remain file artifacts under `src/schemas`.
