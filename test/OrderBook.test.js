const OrderBook = require('../lib/OrderBook')
const { api } = require('../lib/binance')

describe('OrderBook', () => {

	it('integration', (done) => {
		let { ws, rest } = api()
		let ob = new OrderBook(ws, rest, 'ETHBTC')

		ob.on('bid update', (p, q) => console.log(p, q, 'bid update'))
		ob.on('ask update', (p, q) => console.log(p, q, 'ask update'))
		ob.on('bid remove', (p) => console.log(p, 'bid remove'))
		ob.on('ask remove', (p) => console.log(p, 'ask remove'))

		ob.on('depth update event dropped', (e) => {
			console.log('dropped event', e.firstUpdateId)
		})

		ob.on('depth update event processed', (e) => {
			console.log('processed event', e.firstUpdateId)
		})

		ob.start()

		setTimeout(done, 10000)
	})

	it('will drop any buffered events that are chronologically before the snapshot', () => {

	})

	it('will drop new events that are not an immediate continuation of the current state', () => {

	})

	it('will maintain max bid', () => {

	})

	it('will maintain min ask', () => {
		
	})
})
