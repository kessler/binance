const WebSocket = require('ws');
const Beautifier = require('./beautifier.js');
const WebSocketReadableStream = require('./WebSocketReadableStream')
const debug = require('debug')('binance:ws')
const BASE_URL = 'wss://stream.binance.com:9443'

class BinanceWS {

    constructor() {
        this._baseUrl = BASE_URL
        this._sockets = {};
        this._beautifier = new Beautifier();
        this._dataStreamInterval = -1;
    }

    _setupWebSocket(eventHandler, path) {
        if (this._sockets[path]) {
            return this._sockets[path];
        }
        path = `${this._baseUrl}/ws/${path}`;
        const ws = new WebSocket(path);
        ws.on('message', (json) => {
            const data = JSON.parse(json);
            eventHandler(this._beautifier.beautify(data, data.e + 'Event'));
        });
        return ws;
    }

    combinedStreamBuilder() {
        return new CombinedStreamBuilder()
    }

    userDataStream(restApi, options) {
        return new UserDataStream(restApi, options)
    }

    onDepthUpdate(symbol, eventHandler) {
        const path = `${symbol.toLowerCase()}@depth`;
        return this._setupWebSocket(eventHandler, path);
    }

    onKline(symbol, interval, eventHandler) {
        const path = `${symbol.toLowerCase()}@kline_${interval}`;
        return this._setupWebSocket(eventHandler, path);
    }

    onAggTrade(symbol, eventHandler) {
        const path = `${symbol.toLowerCase()}@aggTrade`;
        return this._setupWebSocket(eventHandler, path);
    }

    onUserData(binanceRest, eventHandler, interval) {
        return binanceRest.startUserDataStream()
            .then((response) => {
                return this._setupWebSocket(eventHandler, response.listenKey);
                setInterval(() => {
                    binanceRest.keepAliveUserDataStream(response);
                }, interval || 60000);
            });
    }
}

class UserDataStream extends WebSocketReadableStream {
    constructor(restApi, options) {
        super(options);
        this._restApi = restApi
        this._refreshInterval = undefined
    }

     _start() {
        this._restApi.startUserDataStream()
            .then((response) => {
                this._wsPath = `${BASE_URL}/ws/${response.listenKey}`
                super._start()
                setInterval(() => {
                     this._refreshInterval = this._restApi.keepAliveUserDataStream(response);
                }, 60000);
            });
    }

    _extractData(data) {
        return this._beautifier.beautify(data, data.e + 'Event')
    }
}

class CombinedStream extends WebSocketReadableStream {
    constructor(streams, options) {
        let wsPath = `${BASE_URL}/stream?streams=${Array.from(streams).join('/')}`
        super(options, wsPath);
    }

    _extractData(data) {
        data = data.data
        
        if (data.lastUpdateId && Array.isArray(data.bids) && Array.isArray(data.asks)) {
            data.eventType = `depth_${data.bids.length}`
            return data
        }

        return this._beautifier.beautify(data, data.e + 'Event')
    }
}

class CombinedStreamBuilder {
    constructor() {
        this._streams = new Set();
    }

    [Symbol.iterator]() {
        return this._streams[Symbol.iterator];
    }

    addSymbol(symbol) {
        debug(`CombinedStreamBuilder:addSymbol(${symbol})`)
        symbol = symbol.toLowerCase();
        return new SymbolStreamBuilder(this._streams, symbol);
    }

    createReadStream(options) {
        options = options || { objectMode: false }
        return new CombinedStream(this._streams, options)
    }

    createObjectReadStream(options) {
        options = options || { objectMode: true }
        return new CombinedStream(this._streams, options)
    }
}

class SymbolStreamBuilder {
    constructor(streams, symbol) {
        this._symbol = symbol
        this._streams = streams
    }

    kline(interval) {
        debug(`SymbolStreamBuilder:kline(${interval})`)
        this._streams.add(`${this._symbol}@kline_${interval}`)
        return this
    }

    depth(level) {
        debug(`SymbolStreamBuilder:depth()`)
        let stream = `${this._symbol}@depth`
        if (level) stream += level
        this._streams.add(stream)
        return this
    }

    trade() {
        debug(`SymbolStreamBuilder:trade()`)
        this._streams.add(`${this._symbol}@trade`)
        return this
    }

    aggTrade() {
        debug(`SymbolStreamBuilder:aggTrade()`)
        this._streams.add(`${this._symbol}@aggTrade`)
        return this
    }

    ticker() {
        debug(`SymbolStreamBuilder:ticker()`)
        this._streams.add(`${this._symbol}@ticker`)
        return this   
    }
}

function toStreamPath(streams) {
    return streams.join('/')
}

module.exports = BinanceWS;
