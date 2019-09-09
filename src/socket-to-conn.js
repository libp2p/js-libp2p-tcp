'use strict'

const abortable = require('abortable-iterator')
const log = require('debug')('libp2p:tcp:socket')
const toIterable = require('stream-to-it')
const Multiaddr = require('multiaddr')
const { Address6 } = require('ip-address')
const { CLOSE_TIMEOUT } = require('./constants')

// Convert a socket into a MultiaddrConnection
// https://github.com/libp2p/interface-transport#multiaddrconnection
module.exports = (socket, options) => {
  options = options || {}

  const { sink, source } = toIterable.duplex(socket)
  const localAddr = toMultiaddr(socket.localAddress, socket.localPort)

  // If the remote address was passed, use it - it may have the peer ID encapsulated
  const remoteAddr = options.remoteAddr
    ? options.remoteAddr
    : toMultiaddr(socket.remoteAddress, socket.remotePort)

  return {
    async sink (source) {
      if (options.signal) {
        source = abortable(source, options.signal)
      }

      try {
        await sink((async function * () {
          for await (const chunk of source) {
            // Convert BufferList to Buffer
            yield Buffer.isBuffer(chunk) ? chunk : chunk.slice()
          }
        })())
      } catch (err) {
        // If aborted we can safely ignore
        if (err.type !== 'aborted') {
          // If the source errored the socket will already have been destroyed by
          // toIterable.duplex(). If the socket errored it will already be
          // destroyed. There's nothing to do here except log the error & return.
          log(err)
        }
      }
    },

    source: options.signal ? abortable(source, options.signal) : source,
    conn: socket,
    localAddr,
    remoteAddr,

    close () {
      if (socket.destroyed) return

      return new Promise((resolve, reject) => {
        const start = Date.now()

        // Attempt to end the socket. If it takes longer to close than the
        // timeout, destroy it manually.
        const timeout = setTimeout(() => {
          const { host, port } = remoteAddr.toOptions()
          log('timeout closing socket to %s:%s after %dms, destroying it manually',
            host, port, Date.now() - start)

          if (socket.destroyed) {
            log('%s:%s is already destroyed', host, port)
          } else {
            socket.destroy()
          }

          resolve()
        }, CLOSE_TIMEOUT)

        socket.once('close', () => clearTimeout(timeout))
        socket.end(err => err ? reject(err) : resolve())
      })
    }
  }
}

function toMultiaddr (ip, port) {
  let proto = 'ip4'
  const ip6 = new Address6(ip)

  if (ip6.isValid()) {
    if (ip6.is4()) {
      ip = ip6.to4().correctForm()
    } else {
      proto = 'ip6'
    }
  }

  return Multiaddr(`/${proto}/${ip}/tcp/${port}`)
}
