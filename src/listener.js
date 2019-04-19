'use strict'

const multiaddr = require('multiaddr')
const os = require('os')
const net = require('net')
const EventEmitter = require('events').EventEmitter
const { AllListenersFailedError } = require('interface-transport')
const debug = require('debug')
const log = debug('libp2p:tcp:listen')
log.error = debug('libp2p:tcp:listen:error')

const Libp2pSocket = require('./socket')
const getMultiaddr = require('./get-multiaddr')
const c = require('./constants')

function noop () {}

class Listener extends EventEmitter {
  /**
   * @constructor
   * @param {object} options
   * @param {function(Connection)} handler
   */
  constructor (options, handler) {
    super()
    this._options = options
    this._connectionHandler = handler
    this._servers = new Set()
    this.__connections = new Map()
  }

  /**
   * Whether or not there is currently at least 1 server listening
   * @private
   * @returns {boolean}
   */
  _isListening () {
    return [...this._servers].filter(server => server.listening).length > 0
  }

  /**
   * Closes all open servers
   * @param {object} options
   * @param {number} options.timeout how long before closure is forced, defaults to 2000 ms
   * @returns {Promise}
   */
  close (options = {}) {
    if (!this._isListening()) {
      return
    }

    // Close all running servers in parallel
    return Promise.all(
      [...this._servers].map(server => {
        return new Promise((resolve, reject) => {
          const start = Date.now()

          // Attempt to stop the server. If it takes longer than the timeout,
          // destroy all the underlying sockets manually.
          const timeout = setTimeout(() => {
            log('Timeout closing server after %dms, destroying connections manually', Date.now() - start)
            resolve()
          }, options.timeout || c.CLOSE_TIMEOUT)

          server.once('close', () => {
            clearTimeout(timeout)
            this._servers.delete(server)
          })

          server.close((err) => err ? reject(err) : resolve())
        })
      })
    ).then(() => {
      this.__connections.forEach((connection, key) => {
        log('destroying %s', key)
        connection.destroy()
      })
      this.__connections.clear()
      this._servers.clear()
    })
  }

  /**
   * Creates servers listening on the given `addrs`
   * @async
   * @param {Array<Multiaddr>} addrs
   */
  async listen (addrs) {
    addrs = Array.isArray(addrs) ? addrs : [addrs]

    let listeners = []
    let errors = []

    // Filter out duplicate ports, unless it's port 0
    addrs = uniqueBy(addrs, (addr) => {
      const port = Number(addr.toOptions().port)
      return isNaN(port) || port === 0 ? addr.toString() : port
    })

    for (const ma of addrs) {
      const lOpts = ma.toOptions()

      listeners.push(
        new Promise((resolve) => {
          const server = net.createServer(this._onSocket.bind(this))
          this._servers.add(server)

          server.on('listening', () => this.emit('listening'))
          server.on('close', () => {
            // only emit if we're not listening
            if (!this._isListening()) {
              this.emit('close')
            }
            this._servers.delete(server)
          })
          server.on('error', (err) => this.emit('error', err))

          server.listen(lOpts.port, lOpts.host, (err) => {
            if (err) {
              errors.push(err)
              return resolve()
            }

            log('Listening on %s %s', lOpts.port, lOpts.host)
            resolve()
          })
        })
      )
    }

    return Promise.all(listeners)
      .then(() => {
        errors.forEach((err) => {
          log.error('received an error while attempting to listen', err)
        })

        // All servers failed to listen, throw an error
        if (errors.length === listeners.length) {
          throw new AllListenersFailedError()
        }
      })
  }

  /**
   * Return the addresses we are listening on
   * @throws
   * @returns {Array<Multiaddr>}
   */
  getAddrs () {
    const multiaddrs = []
    this._servers.forEach(server => {
      const address = server.address()

      if (address.address === '0.0.0.0') {
        const netInterfaces = os.networkInterfaces()
        Object.keys(netInterfaces).forEach((niKey) => {
          netInterfaces[niKey].forEach((ni) => {
            if (address.family === ni.family) {
              multiaddrs.push(
                multiaddr.fromNodeAddress({
                  ...address,
                  address: ni.address
                }, 'tcp')
              )
            }
          })
        })
      } else {
        multiaddrs.push(multiaddr.fromNodeAddress(address, 'tcp'))
      }
    })

    if (multiaddrs.length === 0) {
      throw new Error('Listener is not ready yet')
    }

    return multiaddrs
  }

  /**
   * Handler for new sockets from `net.createServer`
   * @param {net.Socket} socket
   */
  _onSocket (socket) {
    // Avoid uncaught errors caused by unstable connections
    socket.on('error', noop)

    const addr = getMultiaddr(socket)
    if (!addr) {
      if (socket.remoteAddress === undefined) {
        log('connection closed before p2p connection made')
      } else {
        log('error interpreting incoming p2p connection')
      }
      return
    }

    log('new connection', addr.toString())

    const s = new Libp2pSocket(socket, addr)

    // Track the connection
    const key = `${socket.remoteAddress}:${socket.remotePort}`
    this.__connections.set(key, socket)
    socket.once('close', () => {
      this.__connections.delete(key)
    })

    this._connectionHandler(s)
    this.emit('connection', s)
  }
}

module.exports = (options, handler) => {
  return new Listener(options, handler)
}

/**
 * Get unique values from `arr` using `getValue` to determine
 * what is used for uniqueness
 * @param {Array} arr The array to get unique values for
 * @param {function(value)} getValue The function to determine what is compared
 * @returns {Array}
 */
function uniqueBy (arr, getValue) {
  return [...new Map(arr.map((i) => [getValue(i), i])).values()]
}
