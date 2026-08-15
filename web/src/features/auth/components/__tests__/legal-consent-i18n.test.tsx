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
import assert from 'node:assert/strict'

import { createInstance } from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { describe, test } from 'vitest'

import zh from '@/i18n/locales/zh.json'

import {
  getLegalConsentTranslationKey,
  getTermsFooterTranslationKey,
} from '../../lib/legal-consent'
import { LegalConsentCopy } from '../legal-consent'
import { TermsFooter } from '../terms-footer'

describe('legal consent internationalization', () => {
  test('selects a complete sentence for every enabled document combination', () => {
    assert.equal(
      getLegalConsentTranslationKey(true, true),
      'I have read and agree to the User Agreement and Privacy Policy.'
    )
    assert.equal(
      getLegalConsentTranslationKey(true, false),
      'I have read and agree to the User Agreement.'
    )
    assert.equal(
      getLegalConsentTranslationKey(false, true),
      'I have read and agree to the Privacy Policy.'
    )
    assert.equal(getLegalConsentTranslationKey(false, false), null)
  })

  test('renders simplified Chinese without hard-coded English connectors', async () => {
    const i18n = createInstance()
    await i18n.init({ lng: 'zh', resources: { zh } })

    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <LegalConsentCopy hasUserAgreement hasPrivacyPolicy />
      </I18nextProvider>
    )

    assert.match(markup, /我已阅读并同意/)
    assert.match(markup, /用户协议/)
    assert.match(markup, /隐私政策/)
    assert.doesNotMatch(markup, /\band the\b|\bI have read\b/)
  })

  test('renders the sign-in footer as one localized sentence', async () => {
    const i18n = createInstance()
    await i18n.init({ lng: 'zh', resources: { zh } })

    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <TermsFooter
          variant='sign-in'
          status={{
            user_agreement_enabled: true,
            privacy_policy_enabled: true,
          }}
        />
      </I18nextProvider>
    )

    assert.match(markup, /点击登录即表示您同意我们的/)
    assert.match(markup, /用户协议/)
    assert.match(markup, /隐私政策/)
    assert.doesNotMatch(markup, /\bBy clicking\b|\bUser Agreement\b/)
  })

  test('selects complete footer sentences for sign-in and sign-up', () => {
    assert.equal(
      getTermsFooterTranslationKey('sign-in', true, true),
      'By clicking sign in, you agree to our User Agreement and Privacy Policy.'
    )
    assert.equal(
      getTermsFooterTranslationKey('sign-up', false, true),
      'By creating an account, you agree to our Privacy Policy.'
    )
    assert.equal(getTermsFooterTranslationKey('sign-up', false, false), null)
  })
})
