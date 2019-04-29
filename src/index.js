'use strict'

const net = require('net')
const mafmt = require('mafmt')
const withIs = require('class-is')
const includes = require('lodash.includes')
const isFunction = require('lodash.isfunction')
const errcode = require('err-code')
const debug = require('debug')
const log = debug('libp2p:tcp:dial')

const Libp2pSocket = require('./socket')
const createListener = require('./listener')
const { AbortError } = require('interface-transport')

function noop () {}

class TCP {
  async dial (ma, options) {
    const cOpts = ma.toOptions()
    log('Dialing %s:%s', cOpts.host, cOpts.port)

    const rawSocket = await this._connect(cOpts, options)
    return new Libp2pSocket(rawSocket, ma, options)
  }

  _connect (cOpts, options = {}) {
    return new Promise((resolve, reject) => {
      if ((options.signal || {}).aborted) {
        return reject(new AbortError())
      }

      const start = Date.now()
      const rawSocket = net.connect(cOpts)

      const onError = (err) => {
        const msg = `Error dialing ${cOpts.host}:${cOpts.port}: ${err.message}`
        done(errcode(msg, err.code))
      }

      const onTimeout = () => {
        log('Timeout dialing %s:%s', cOpts.host, cOpts.port)
        const err = errcode(`Timeout after ${Date.now() - start}ms`, 'ETIMEDOUT')
        // Note: this will result in onError() being called
        rawSocket.emit('error', err)
      }

      const onConnect = () => {
        log('Connected to %s:%s', cOpts.host, cOpts.port)
        done(null, rawSocket)
      }

      const onAbort = () => {
        log('Dial to %s:%s aborted', cOpts.host, cOpts.port)
        rawSocket.destroy()
        done(new AbortError())
      }

      const done = (err, res) => {
        rawSocket.removeListener('error', onError)
        rawSocket.removeListener('timeout', onTimeout)
        rawSocket.removeListener('connect', onConnect)

        options.signal && options.signal.removeEventListener('abort', onAbort)

        err ? reject(err) : resolve(res)
      }

      rawSocket.once('error', onError)
      rawSocket.once('timeout', onTimeout)
      rawSocket.once('connect', onConnect)
      options.signal && options.signal.addEventListener('abort', onAbort)
    })
  }

  createListener (options, handler) {
    if (isFunction(options)) {
      handler = options
      options = {}
    }

    handler = handler || noop
    return createListener(handler)
  }

  filter (multiaddrs) {
    if (!Array.isArray(multiaddrs)) {
      multiaddrs = [multiaddrs]
    }

    return multiaddrs.filter((ma) => {
      if (includes(ma.protoNames(), 'p2p-circuit')) {
        return false
      }

      if (includes(ma.protoNames(), 'ipfs')) {
        ma = ma.decapsulate('ipfs')
      }

      return mafmt.TCP.matches(ma)
    })
  }
}

module.exports = withIs(TCP, { className: 'TCP', symbolName: '@libp2p/js-libp2p-tcp/tcp' })
