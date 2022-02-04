import { connect, Contract, keyStores, WalletConnection } from 'near-api-js'
import getConfig from './config'

const nearConfig = getConfig(process.env.NODE_ENV || 'development')

// Initialize contract & set global variables
export async function initContract() {
  // Initialize connection to the NEAR testnet
  const near = await connect(Object.assign({ deps: { keyStore: new keyStores.BrowserLocalStorageKeyStore() } }, nearConfig))

  // Initializing Wallet based Account. It can work with NEAR testnet wallet that
  // is hosted at https://wallet.testnet.near.org
  window.walletConnection = new WalletConnection(near)

  // Getting the Account ID. If still unauthorized, it's just empty string
  window.accountId = window.walletConnection.getAccountId()

  // Initializing our contract APIs by contract name and configuration
  window.contract = await new Contract(window.walletConnection.account(), nearConfig.contractName, {
    // View methods are read only. They don't modify the state, but usually return some value.
    viewMethods: [
      'getAccessoriesForUser', // - ok
      'getGameTokens', // - ok
      'getGlobalAccessories', // - ok
      'getUserObject', // - ok
      'hasAccessory', // - ok
      'turnsToPlay', // - ok
      'getLine', // - ok
      'getUserId', // - ok
      'getGameConfig', // - ok
      'getAccessory',
    ],
    // Change methods can modify the state. But you don't receive the returned value when called.
    changeMethods: [
      'buyAccessory',             // user - payable - ok
      'takeUserOwnership',        // user - payable - ok
      'buyAccessoryWithPoints',   // user  - ok

      'addToLine',                // admin - ok
      'allocateUser',             // admin - ok
      'peek',                     // admin - ok
      'rewardGameToken',          // admin - ok
      'rewardPoints',             // admin - ok
      'setBaseURI',               // admin - ok
      'setMaxLineCapacity',       // admin - ok 
      'setMaxPointsReward',       // admin - ok
      'setPriceToUnlockUser',     // admin - ok
      'setPriceForAccessory',     // admin - ok
      'unlockAccessoryForPublic', // admin - ok
      'removeAccessoryForPublic', // admin - ok
      'unlockAccessoryForUser',   // admin - ok
    ],
  })
}

export function logout() {
  window.walletConnection.signOut()
  // reload page
  window.location.replace(window.location.origin + window.location.pathname)
}

export function login() {
  // Allow the current app to make calls to the specified contract on the
  // user's behalf.
  // This works by creating a new access key for the user's account and storing
  // the private key in localStorage.
  window.walletConnection.requestSignIn(nearConfig.contractName)
}
