const axios = require('axios')
const crypto = require('crypto')
const https = require('https')

class MPesa {
  constructor() {
    this.apiKey = process.env.MPESA_API_KEY
    this.publicKey = process.env.MPESA_PUBLIC_KEY
    this.serviceProviderCode = process.env.MPESA_SERVICE_PROVIDER_CODE || '171717'
    this.initiatorIdentifier = process.env.MPESA_INITIATOR_IDENTIFIER || 'MPesa2018'
    this.securityCredential = process.env.MPESA_SECURITY_CREDENTIAL || 'Mpesa2019'
    this.sandbox = process.env.MPESA_SANDBOX === 'true'
    this.baseUrl = this.sandbox ? 'api.sandbox.vm.co.mz' : 'api.vm.co.mz'
    this.agent = new https.Agent({ rejectUnauthorized: false })
  }

  getBearer() {
    const pk = `-----BEGIN PUBLIC KEY-----\n${this.publicKey}\n-----END PUBLIC KEY-----`
    const encrypted = crypto.publicEncrypt(
      { key: pk, padding: crypto.constants.RSA_PKCS1_PADDING },
      Buffer.from(this.apiKey)
    )
    return encrypted.toString('base64')
  }

  getHeaders() {
    return {
      'Authorization': `Bearer ${this.getBearer()}`,
      'Origin': '*',
      'Content-Type': 'application/json'
    }
  }

  async c2b({ amount, msisdn, transactionReference, thirdPartyReference }) {
    const url = `https://${this.baseUrl}:18352/ipg/v1x/c2bPayment/singleStage/`
    const { data } = await axios.post(url, {
      input_TransactionReference: transactionReference,
      input_CustomerMSISDN: `258${msisdn}`,
      input_Amount: String(amount),
      input_ThirdPartyReference: thirdPartyReference,
      input_ServiceProviderCode: this.serviceProviderCode
    }, { headers: this.getHeaders(), httpsAgent: this.agent })
    return data
  }

  async queryStatus({ queryReference, thirdPartyReference }) {
  const url = `https://${this.baseUrl}:18353/ipg/v1x/queryTransactionStatus/`
  
  console.log('🔍 QueryStatus enviando:', {
    input_QueryReference: queryReference,
    input_ThirdPartyReference: thirdPartyReference,
    input_ServiceProviderCode: this.serviceProviderCode
  })

  const { data } = await axios.get(url, {
    params: {
      input_QueryReference: queryReference,
      input_ThirdPartyReference: thirdPartyReference,
      input_ServiceProviderCode: this.serviceProviderCode
    },
    headers: this.getHeaders(),
    httpsAgent: this.agent
  })

  console.log('🔍 QueryStatus resposta:', data)
  return data
}

  async reversal({ transactionID, amount, thirdPartyReference }) {
    const url = `https://${this.baseUrl}:18354/ipg/v1x/reversal/`
    const { data } = await axios.put(url, {
      input_TransactionID: transactionID,
      input_SecurityCredential: this.securityCredential,
      input_InitiatorIdentifier: this.initiatorIdentifier,
      input_ThirdPartyReference: thirdPartyReference,
      input_ServiceProviderCode: this.serviceProviderCode,
      input_ReversalAmount: String(amount)
    }, { headers: this.getHeaders(), httpsAgent: this.agent })
    return data
  }
}

module.exports = new MPesa()
