const crypto = require('node:crypto')
const keyPem =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAlY1Gvw+23owlqrSryUIiEChBhPpL4tZW8H4wYfu1PSQ8m8gR7ufXropxqGmR4EzSIlOI7ojivzeapdB2GoHyx5sfZgd23pecLdddPqKVMONGU2cx3ZgCu4jujcT43DNuGJRg026qIaPo4nbRpO8JAAyJKApCtrXUpr+1SzPFHQYdWhACSadWF/jc2JVjfgXY75izBwe/cJ6PRXS6IUOqwk99wQY9pJtXLp0yX7xU/Y03aByrnIJrz3T5BnQsA/1JMvWOYBtqJzVD6F3TBE8xEqGBGB+AGKHBrP65BpaM16A3wm3t8X76P1hkYiD2ZywuPD+n1ZfFvUVyTA3AjQjjMwIDAQAB'

const pubKeyBytes = Buffer.from(keyPem, 'base64')
const hash = crypto.createHash('sha256').update(pubKeyBytes).digest()
const hex = hash.toString('hex').slice(0, 32)

const id = Array.from(hex)
  .map((c) => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16)))
  .join('')

console.log('ID:', id)
