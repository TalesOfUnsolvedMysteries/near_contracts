// We're all stars now in the bug show

import { Context, logging, math, PersistentMap, PersistentVector, storage, u128, u256 } from 'near-sdk-as'

// contract owner is the same as Context.contractName

const priceToUnlockUserKey = "priceToUnlockUser"

const accountToUser = new PersistentMap<string, u32>("accUser")
const userToAccount = new PersistentMap<u32, string>("userAcc")
const userToUnlock = new PersistentMap<u32, Uint8Array>("userUnlock")
const nextUserIdKey = "nextUserId";

// Accessories
const globalAccessories = new PersistentVector<u8>("gAccessories");
const premiumAccessories = new PersistentVector<u8>("pAccessories");

const userToAccessories = new PersistentMap<u32, u8[]>("userAccessories")
const accessoriesToPrices = new PersistentMap<u8, u128>("accessoriesPrices")
const accessoriesToPointsPrice = new PersistentMap<u8, u32>("accessoriesPointsPrices")

// token souvenir?
const _baseURIKey = "_baseURI"

@nearBindgen
class GameToken {
  uriMetadata: string;
  owner: u32;
  migrated: bool;
  constructor (uriMetadata: string, owner: u32, migrated: bool) {
    this.uriMetadata = uriMetadata
    this.owner = owner
    this.migrated = migrated
  }
}

// user idto game tokens earned
const gameTokens = new PersistentVector<GameToken>("gameTokens")
const userToGameTokens = new PersistentMap<u32, u32[]>("userGameTokens")

// score points can be transmutated to erc20 tokens
const userToPoints = new PersistentMap<u32, u32>("userPoints")
const maxPointsRewardKey = "maxPointsReward" // 1000


@nearBindgen
class GameUser {
  userId: u32;
  nearAccount: string;
  unlockKey: Uint8Array;
  accessories: u8[];
  gameTokens: u32[];
  points: u32;
  claimed: bool;
  turn: u32;
}

// waiting line

const waitingLine = new PersistentMap<u32, u32>("line") //  userId -> next userId
const userToTurn = new PersistentMap<u32, u32>("lineTurn")  // useId -> turn in line
const maxLineCapacityKey = "maxLineCapacity"
const lineLengthKey = "lineLength"
const lastTurnKey = "lastTurn"
const firstInLineKey = "firstInLine"
const lastInLineKey = "lastInLine"

// utilities
function isOwner (): bool {
  return Context.sender == Context.contractName
}

// admin functions
export function setPriceToUnlockUser (price: u128): void {
  assert(isOwner(), "You are not authorized to run this function")
  assert(!price.isZero(), "price must be greater than zero")
  let priceToUnlockUser = u128.One
  if (storage.hasKey(priceToUnlockUserKey)) {
    priceToUnlockUser = storage.getSome<u128>(priceToUnlockUserKey)
  }
  assert(price == priceToUnlockUser, "price cant be the same")
  storage.set<u128>(priceToUnlockUserKey, price)
}

export function setMaxPointsReward (maxPointsReward: u16): void {
  assert(isOwner(), "You are not authorized to run this function")
  storage.set<u16>(maxPointsRewardKey, maxPointsReward)
}

export function setBaseURI (uri: string): void {
  assert(isOwner(), "You are not authorized to run this function")
  storage.setString(_baseURIKey, uri)
}

export function setMaxLineCapacity (maxLineCapacity: u16): void {
  assert(isOwner(), "You are not authorized to run this function")
  storage.set<u16>(maxLineCapacityKey, maxLineCapacity)
}

export function allocateUser (uuid: string, unlockKey: Uint8Array): void {
  assert(isOwner(), "You are not authorized to run this function")
  let nextUserId = u32.MIN_VALUE
  if (storage.hasKey(nextUserIdKey)) {
    nextUserId = storage.getSome<u32>(nextUserIdKey)
  }
  assert(nextUserId < u32.MAX_VALUE, "max number of player reached")
  userToUnlock.set(nextUserId, unlockKey)
  storage.set<u32>(nextUserIdKey, nextUserId + 1)
  // how to emit an event? TODO
}

function _addAccessoryToUser (userId: u32, accessoryId: u8): void {
  let accessories: u8[] = []
  if (userToAccessories.contains(userId)) {
    accessories = userToAccessories.getSome(userId)
  }
  accessories.push(accessoryId)
  userToAccessories.set(userId, accessories)
}
    
function hasAccessory(userId: u32, accessoryId: u8): bool {
  if (!userToAccessories.contains(userId)) {
    return false
  }
  const accessories = userToAccessories.getSome(userId)
  // search if accessory_id is already registered for this user;
  for (let i = 0; i < accessories.length; i++) {
      const _accessoryId = accessories[i]
      if (_accessoryId == 0) {
          break;
      }
      if (_accessoryId == accessoryId) {
          return true
      }
  }
  return false
}

function mergeUsers (userIdCell: u32, userIdAndroid: u32): void {
  // merge accessories, check for possible duplicates
  let _androidAccessories: u8[] = []
  if (userToAccessories.contains(userIdAndroid)) {
    _androidAccessories = userToAccessories.getSome(userIdAndroid)
  }
  for (let i = 0; i < _androidAccessories.length; i++ ) {
    const accessoryId = _androidAccessories[i]
    if (!hasAccessory(userIdCell, accessoryId)) {
      _addAccessoryToUser(userIdCell, accessoryId)
    }
  }
  userToAccessories.delete(userIdAndroid)

  // merge game tokens, concatenate
  let _gameTokenIndexes: u32[] = []
  if (userToGameTokens.contains(userIdAndroid)) {
    _gameTokenIndexes = userToGameTokens.getSome(userIdAndroid)
  }
  let gameTokenIndexes: u32[] = []
  if (userToGameTokens.contains(userIdCell)) {
    gameTokenIndexes = userToGameTokens.getSome(userIdCell)
  }
  for (let i = 0; i < _gameTokenIndexes.length; i++) {
    const _tokenIndex = _gameTokenIndexes[i]
    gameTokens[_tokenIndex].owner = userIdCell
    gameTokenIndexes.push(_tokenIndex)
  }
  userToGameTokens.delete(userIdAndroid)
  userToGameTokens.set(userIdCell, gameTokenIndexes)

  // merge game score
  let oldScore = 0
  if (userToPoints.contains(userIdAndroid)) {
    oldScore = userToPoints.getSome(userIdAndroid)
  }
  let currentScore = 0
  if (userToPoints.contains(userIdCell)) {
    currentScore = userToPoints.getSome(userIdCell)
  }
  userToPoints.set(userIdCell, oldScore + currentScore)
  userToPoints.delete(userIdAndroid)

  // delete old user association
  userToAccount.delete(userIdAndroid)
}

@payable
export function takeUserOwnership (userId: u32, secret: string): void {
  const attachedDeposit = Context.attachedDeposit
  let priceToUnlockUser = u128.One
  if (storage.contains(priceToUnlockUserKey)) {
    priceToUnlockUser = storage.getSome<u128>(priceToUnlockUserKey)
  }
  assert(attachedDeposit == priceToUnlockUser, "unlock the user requires a deposit of $")
  const unlockKey = userToUnlock.getSome(userId)
  
  assert(math.keccak256(encode<string, Uint8Array>(secret)) == unlockKey, "the secret word is not correct")
  // check if there is an existing user id associated to this msg.sender
  const sender = Context.sender
  if (accountToUser.contains(sender)) {
    const previousUserId: u32 = accountToUser.getSome(sender)
    mergeUsers(userId, previousUserId)
  }
  accountToUser.set(sender, userId)
  userToAccount.set(userId, sender)
  userToUnlock.delete(userId)
  // total_crypto += price_to_unlock_user;
}

// accessories functionality
export function unlockAccessoryForPublic (accessoryId: u8): void {
  assert(isOwner(), "You are not authorized to run this function")
  assert(accessoryId <= 125, "ids greater than 125 are reserved for premium accessories")
  for (let i = 0; i < globalAccessories.length; i++) {
      const _accessoryId = globalAccessories[i];
      if (_accessoryId == 0) {
          break;
      }
      assert(_accessoryId != accessoryId, "accessory already included");
  }
  globalAccessories.push(accessoryId);
}

export function removeAccessoryForPublic (accessoryId: u8): void {
  assert(isOwner(), "You are not authorized to run this function")
  for (let i = 0; i < globalAccessories.length; i++) {
      const _accessoryId = globalAccessories[i];
      if (_accessoryId == accessoryId) {
          globalAccessories.swap_remove(i)
          break;
      }
  }
}

export function setPriceForAccessory(accessoryId: u8, price: u128, pointsPrice: u32): void {
  assert(isOwner(), "You are not authorized to run this function")
  assert(accessoryId > 125, "ids from 0 to 125 are reserved for free global accessories");
  // price should be greater than zero
  assert(!price.isZero(), "price must be greater than zero");
  assert(pointsPrice > 0, "price in points must be greater than zero");
  accessoriesToPrices.set(accessoryId, price)
  accessoriesToPointsPrice.set(accessoryId, pointsPrice)
  premiumAccessories.push(accessoryId)
}

export function unlockAccessoryForUser(userId: u32, accessoryId: u8): void {
  assert(isOwner(), "You are not authorized to run this function")
  assert(!hasAccessory(userId, accessoryId), "accessory is already registered for this user")
  _addAccessoryToUser(userId, accessoryId)
}

@payable
export function buyAccessory(accessoryId: u8): void {
  assert(accessoryId > 125, "ids from 0 to 125 are reserved for free global accessories")
  const priceForAccessory = accessoriesToPrices.getSome(accessoryId)
  const userAccount = Context.sender
  const _userId = accountToUser.getSome(userAccount)
  assert(!hasAccessory(_userId, accessoryId), "accessory is already registered for this user")
  const value = Context.attachedDeposit
  assert(value == priceForAccessory, "is not the right price")
  _addAccessoryToUser(_userId, accessoryId)
  // total_crypto += value; 
}

export function buyAccessoryWithPoints(accessoryId: u8): void {
  assert(accessoryId > 125, "ids from 0 to 125 are reserved for free global accessories")
  const pointsForAccessory = accessoriesToPointsPrice.getSome(accessoryId)
  const userAccount = Context.sender
  const _userId = accountToUser.getSome(userAccount)
  assert(!hasAccessory(_userId, accessoryId), "accessory is already registered for this user")
  let value: u32 = 0
  if (userToPoints.contains(_userId)) {
    value = userToPoints.getSome(_userId)
  }
  assert(value >= pointsForAccessory, "user don't have enough points to buy this accessory")
  userToPoints.set(_userId, value - pointsForAccessory)
  _addAccessoryToUser(_userId, accessoryId)
}

export function getAccessoriesForUser (userId: u32): u8[] {
  if (userToAccessories.contains(userId)) {
    return userToAccessories.getSome(userId)
  }
  return []
}

// TODO
export function getGlobalAccessories (): u8[] {
  const accessories: u8[] = []
  for (let i = 0; i < globalAccessories.length; i++) {
    accessories.push(globalAccessories[i]);
  }
  return accessories;
}

// game tokens - only rewarded by the admin 
export function rewardGameToken (userId: u32, uriMetadata: string): void {
  assert(isOwner(), "You are not authorized to run this function")
  assert(userId != 0, "a valid user_id is required")
  const gameToken = new GameToken(uriMetadata, userId, false)
  gameTokens.push(gameToken)
  const _lastIndex = gameTokens.length - 1
  let _gameTokens: u32[] = []
  if (userToGameTokens.contains(userId)) {
    _gameTokens = userToGameTokens.getSome(userId)
  }
  _gameTokens.push(_lastIndex)
  userToGameTokens.set(userId, _gameTokens)
  //emit tokenRewarded(user_id, _last_index) TODO
}
  
export function getGameTokens (userId: u32): GameToken[] {
  assert(userId != 0, "a valid user id is required")
  let _tokenIndexes: u32[] = []
  if (userToGameTokens.contains(userId)) {
    _tokenIndexes = userToGameTokens.getSome(userId)
  }
  return _tokenIndexes.map<GameToken>((tokenIndex: u32) => gameTokens[tokenIndex])
}
  
export function rewardPoints (userId: u32, points: u32): void {
  assert(isOwner(), "You are not authorized to run this function")
  assert(userId != 0, "a valid user id is required")
  assert(points > 0, "score points must be greater than zero")
  let maxPointsReward: u16 = 0
  if (storage.contains(maxPointsRewardKey)) {
    maxPointsReward = storage.getSome<u16>(maxPointsRewardKey)
  }
  assert(points <= maxPointsReward, "score points can't be greater than max_points_reward")
  
  let currentPoints: u32 = 0
  if (userToPoints.contains(userId)) {
    currentPoints = userToPoints.getSome(userId)
  }
  userToPoints.set(userId, currentPoints + points)
  //emit pointsRewarded(user_id, user_points[user_id])
}
  
// user object

export function getUserObject (userId: u32): GameUser|null {
  let nextUserId: u32 = 1
  if (storage.contains(nextUserIdKey)) {
    nextUserId = storage.getSome<u32>(nextUserIdKey)
  }
  assert(userId > 0 && userId < nextUserId, "a valid user id is required")
  
  const unlockKey = userToUnlock.get(userId)
  const account = userToAccount.getSome(userId)

  //return null
  const user = new GameUser()
  user.userId = userId;
  user.nearAccount = account
  user.claimed = unlockKey == null
  if (unlockKey != null) {
    user.unlockKey = unlockKey
  }
  user.accessories = []
  if (userToAccessories.contains(userId)) {
    user.accessories = userToAccessories.getSome(userId)
  }
  user.gameTokens = []
  if (userToGameTokens.contains(userId)) {
    user.gameTokens = userToGameTokens.getSome(userId)
  }
  user.points = 0
  if (userToPoints.contains(userId)) {
    user.points = userToPoints.getSome(userId)
  }
  user.turn = 0
  if (userToTurn.contains(userId)) {
    user.turn = userToTurn.getSome(userId)
  }
  return user
}
  
// line
export function addToLine (userId: u32): void {
  assert(isOwner(), "You are not authorized to run this function")
  assert(userId != 0, "user id not valid")
  const lineLength = storage.getPrimitive(lineLengthKey, 0)
  const maxLineCapacity = storage.getPrimitive(maxLineCapacityKey, 0)
  assert(lineLength < maxLineCapacity, "max capacity for line")
  const lastInLine = storage.getPrimitive(lastInLineKey, 0)
  assert(!waitingLine.contains(userId) && lastInLine != userId, "user is already in line") // default value is zero for all uint variables

  // increase the size of the line
  storage.set(lineLengthKey, lineLength + 1)
  
  // if there is no a last player in line this user id will be the first player in line
  if (lastInLine == 0) {
    storage.set(firstInLineKey, userId)
  } else { // if not it will be assigned to the last player in line
    waitingLine.set(lastInLine, userId)
  }
  
  // this player becomes the last player in line
  storage.set(lastInLineKey, userId)
  
  // increase the turn number and assign it to this user id
  const lastTurn = storage.getPrimitive(lastTurnKey, 0)
  storage.set(lastTurnKey, lastTurn + 1)
  
  userToTurn.set(userId, lastTurn)
  
  // return the turn assigned
  // emit turnAssigned(user_id, last_turn) TODO ? can I just return instead of emiting signals?
}
  
export function peek (): void {
  assert(isOwner(), "You are not authorized to run this function")
  const firstInLine = storage.getPrimitive(firstInLineKey, 0)
  assert(firstInLine != 0, "there are no users in line")
  const previousUser = firstInLine
  let nextUser = 0
  if (waitingLine.contains(firstInLine)) {
    nextUser = waitingLine.getSome(firstInLine)
  }
  storage.set(firstInLineKey, nextUser)
  if (nextUser == 0) {
    storage.set(lastInLineKey, 0)
  }
  const lineLength = storage.getPrimitive(lineLengthKey, 0)
  storage.set(lineLengthKey, lineLength - 1)
  waitingLine.delete(previousUser)
  userToTurn.delete(previousUser)
  // emit linePeeked(previous_user) - TODO return previousUser?
}

export function turnsToPlay(userId: u32): u32 {
  let turn = u32.MAX_VALUE
  if (userToTurn.contains(userId)) {
    turn = userToTurn.getSome(userId)
  }
  const firstInLine = storage.getPrimitive(firstInLineKey, 0)
  let firstInLineTurn = 0
  if (userToTurn.contains(firstInLine)) {
    firstInLineTurn = userToTurn.getSome(firstInLine)
  }
  return turn - firstInLineTurn
}
  

export function getLine(): u32[] {
  const line: u32[] = [];
  const firstInLine = storage.getPrimitive(firstInLineKey, 0)
  let _userIterator = firstInLine;
  while (_userIterator != 0) {
    line.push(_userIterator)
    if (waitingLine.contains(_userIterator)) {
      _userIterator = waitingLine.getSome(_userIterator)
    } else {
      _userIterator = 0
    }
  }
  return line;
}