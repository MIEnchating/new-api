import fs from 'node:fs/promises'
import path from 'node:path'

const LOCALES_DIR = path.resolve('src/i18n/locales')

function stableStringify(obj) {
  return JSON.stringify(obj, null, 2) + '\n'
}

const newKeys = {
  en: {
    'Supplier display order': 'Supplier display order',
    'Supplier order must be a list of unique names':
      'Supplier order must be a list of unique names',
  },
  zh: {
    'Supplier display order': '供应商展示顺序',
    'Supplier order must be a list of unique names':
      '供应商顺序必须为名称不重复的列表',
  },
  'zh-TW': {
    'Supplier display order': '供應商顯示順序',
    'Supplier order must be a list of unique names':
      '供應商順序必須是名稱不重複的清單',
  },
  fr: {
    'Supplier display order': 'Ordre d’affichage des fournisseurs',
    'Supplier order must be a list of unique names':
      'L’ordre des fournisseurs doit contenir des noms uniques',
  },
  ja: {
    'Supplier display order': 'ベンダーの表示順',
    'Supplier order must be a list of unique names':
      'ベンダーの並び順には重複しない名前のリストを指定してください',
  },
  ru: {
    'Supplier display order': 'Порядок отображения поставщиков',
    'Supplier order must be a list of unique names':
      'Укажите список поставщиков с уникальными названиями',
  },
  vi: {
    'Supplier display order': 'Thứ tự hiển thị nhà cung cấp',
    'Supplier order must be a list of unique names':
      'Thứ tự nhà cung cấp phải là danh sách tên không trùng lặp',
  },
}

async function main() {
  let totalAdded = 0

  for (const [locale, trans] of Object.entries(newKeys)) {
    const filePath = path.join(LOCALES_DIR, `${locale}.json`)
    const json = JSON.parse(await fs.readFile(filePath, 'utf8'))

    let count = 0
    for (const [key, value] of Object.entries(trans)) {
      if (!Object.prototype.hasOwnProperty.call(json.translation, key)) {
        json.translation[key] = value
        count++
      } else if (json.translation[key] !== value) {
        json.translation[key] = value
        count++
      }
    }

    if (count > 0) {
      json.translation = Object.fromEntries(
        Object.entries(json.translation).sort(([a], [b]) => a.localeCompare(b))
      )
      await fs.writeFile(filePath, stableStringify(json), 'utf8')
    }

    console.log(`${locale}: ${count} translations applied`)
    totalAdded += count
  }

  console.log(`\nTotal: ${totalAdded} translations applied`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
