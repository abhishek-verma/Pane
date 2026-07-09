const crypto = require('node:crypto')
// This is the key from wxt.config.ts
const keyPem =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvBDAaDRvv61NpBeLR8etBRw82lv9VJO3sz/mA26gDzWKtVuzW4DXCl8Zfj5oWmoXLTfv3aiTigUXo/LHOoGpSucEVroMmAc7cgu2KuQ1fZPpMvYa0npD/m4h89360q8Oz0oKKaZGS905IJ04M2IkF4CuU3YEHFJBWb+cUyK9H8YVugelYbPD0IVs63T1SkGbh/t/Tfb2DpkinduSO8+x26sKydm30SRt+iZ2+7Nolcdum3LExInUiX2Pgb65Jb+mVw8NqyTVJyCEp8uq0cSHomWFQirSJ80tsDhISp4btwaRKHrXqovQx9XHQv4hCd+3LuB830eUEVMUNuCO+OyPxQIDAQAB'

const pubKeyBytes = Buffer.from(keyPem, 'base64')
const hash = crypto.createHash('sha256').update(pubKeyBytes).digest()
const hex = hash.toString('hex').slice(0, 32)

// Chrome extension ID encoding is a simple translation from hex to characters a-p
const id = Array.from(hex)
  .map((c) => {
    const num = parseInt(c, 16)
    return String.fromCharCode('a'.charCodeAt(0) + num)
  })
  .join('')

console.log('ID:', id)
