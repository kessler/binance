const rc = require('rc')
const BinanceRest = require('./rest.js')
const BinanceWS = require('./ws.js')

module.exports = {
	BinanceRest,
	BinanceWS,

	/**
	 *	create api instances with defaults and config (rc[binance-api])
	 */
	api: (config) => {
		config = config || rc('binance-api', { key: undefined, secret: undefined })

		if (!config.key) throw new Error('missing key')
		if (!config.secret) throw new Error('missing secret')

		const rest = new BinanceRest({
			key: config.key,
			secret: config.secret,
			timeout: 15000, // Optional, defaults to 15000, is the request time out in milliseconds
			recvWindow: 5000, // Optional, defaults to 5000, increase if you're getting timestamp errors
			disableBeautification: false
		})

		const ws = new BinanceWS()

		return { rest, ws }
	}
}
