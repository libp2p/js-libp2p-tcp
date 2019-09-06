'use strict'

const abortable = require('abortable-iterator')
const log = require('debug')('libp2p:tcp:socket')
const toIterable = require('stream-to-it')
const Multiaddr = require('multiaddr')
const { Address6 } = require('ip-address')
const { CLOSE_TIMEOUT } = require('./constants')

// Convert a socket into a MultiaddrConnection
// https://github.com/libp2p/interface-transport#multiaddrconnection
module.exports = function toConnection (socket, options) {
  options = options || {}

  const duplex = toIterable.duplex(socket)
  const { sink } = duplex

  duplex.sink = async source => {
    try {
      await sink(source)
    } catch (err) {
      // If aborted we can safely ignore
      if (err.type !== 'aborted') {
        // If the source errored the socket will already have been destroyed by
        // toIterable.duplex(). If the socket errored it will already be
        // destroyed. There's nothing to do here except log the error & return.
        log(err)
      }
    }
  }

  const conn = options.signal ? abortable.duplex(duplex, options.signal) : duplex

  conn.conn = socket

  conn.localAddr = (() => {
    const ip = socket.localAddress
    const port = socket.localPort
    return Multiaddr(`/ip4/${ip}/tcp/${port}`) // FIXME: ip6??
  })()

  conn.remoteAddr = (() => {
    let proto = 'ip4'
    let ip = socket.remoteAddress

    if (socket.remoteFamily === 'IPv6') {
      const ip6 = new Address6(ip)

      if (ip6.is4()) {
        ip = ip6.to4().correctForm()
      } else {
        proto = 'ip6'
      }
    }

    return Multiaddr(`/${proto}/${ip}/tcp/${socket.remotePort}`)
  })()

  conn.close = async options => {
    options = options || {}
    if (socket.destroyed) return

    return new Promise((resolve, reject) => {
      const start = Date.now()

      // Attempt to end the socket. If it takes longer to close than the
      // timeout, destroy it manually.
      const timeout = setTimeout(() => {
        const { host, port } = conn.remoteAddr.toOptions()
        log('Timeout closing socket to %s:%s after %dms, destroying it manually',
          host, port, Date.now() - start)
        socket.destroy()
        resolve()
      }, options.timeout || CLOSE_TIMEOUT)

      socket.once('close', () => clearTimeout(timeout))
      socket.end(err => err ? reject(err) : resolve())
    })
  }

  return conn
}
