'use strict'

const {connect} = require('pull-net')
const mafmt = require('mafmt')
const withIs = require('class-is')
const includes = require('lodash.includes')
const isFunction = require('lodash.isfunction')
const Connection = require('interface-connection').Connection
const once = require('once')
const debug = require('debug')
const log = debug('libp2p:tcp:dial')

const createListener = require('./listener')

function noop () {}

class TCP {
  dial (ma, options, callback) {
    if (isFunction(options)) {
      callback = options
      options = {}
    }

    callback = once(callback || noop)

    const cOpts = ma.toOptions()
    log('Connecting to %s %s', cOpts.port, cOpts.host)

    const conn = new Connection(connect(cOpts.port, cOpts.host, callback))

    conn.getObservedAddrs = (callback) => {
      return callback(null, [ma])
    }

    return conn
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
