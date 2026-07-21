/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
export function getLegalConsentTranslationKey(
  hasUserAgreement: boolean,
  hasPrivacyPolicy: boolean
): string | null {
  if (hasUserAgreement && hasPrivacyPolicy) {
    return 'I have read and agree to the User Agreement and Privacy Policy.'
  }
  if (hasUserAgreement) {
    return 'I have read and agree to the User Agreement.'
  }
  if (hasPrivacyPolicy) {
    return 'I have read and agree to the Privacy Policy.'
  }
  return null
}

export function getTermsFooterTranslationKey(
  variant: 'sign-in' | 'sign-up',
  hasUserAgreement: boolean,
  hasPrivacyPolicy: boolean
): string | null {
  const prefix =
    variant === 'sign-in'
      ? 'By clicking sign in, you agree to our'
      : 'By creating an account, you agree to our'
  if (hasUserAgreement && hasPrivacyPolicy) {
    return `${prefix} User Agreement and Privacy Policy.`
  }
  if (hasUserAgreement) {
    return `${prefix} User Agreement.`
  }
  if (hasPrivacyPolicy) {
    return `${prefix} Privacy Policy.`
  }
  return null
}
