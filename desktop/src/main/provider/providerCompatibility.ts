import {
  HRT_CONTRACT_VERSION,
  HRT_PROVIDER_COMPATIBILITY_MATRIX,
  HrtCapability,
  HrtCompatibilityMatrixEntry,
  HrtProviderRegistrationPayload,
} from '@eshop/hrt-contract'

export const WINDOWS_PROVIDER_ID = 'windows-provider'

export const WINDOWS_PROVIDER_COMPATIBILITY_MATRIX: HrtCompatibilityMatrixEntry = {
  providerId: WINDOWS_PROVIDER_ID,
  minProviderVersion: HRT_PROVIDER_COMPATIBILITY_MATRIX.minProviderVersion,
  maxProviderVersionExclusive: HRT_PROVIDER_COMPATIBILITY_MATRIX.maxProviderVersionExclusive,
  requiredCapabilities: ['printer.receipt'],
}

export function requiredWindowsProviderCapabilities(): HrtCapability[] {
  return [...WINDOWS_PROVIDER_COMPATIBILITY_MATRIX.requiredCapabilities]
}

export function isCompatibleWindowsProvider(registration: HrtProviderRegistrationPayload): boolean {
  if (registration.providerId !== WINDOWS_PROVIDER_ID) return false
  if (registration.contractVersion !== HRT_CONTRACT_VERSION) return false
  return WINDOWS_PROVIDER_COMPATIBILITY_MATRIX.requiredCapabilities.every((capability) =>
    registration.supportedCapabilities.includes(capability),
  )
}
