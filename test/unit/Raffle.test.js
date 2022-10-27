const { assert, expect } = require("chai");
const { getNamedAccounts, deployments, ethers, network } = require("hardhat");
const { developmentChains, networkConfig } = require("../../helper-hardhat-config");

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle Unit Tests", function () {
          let raffle, vrfCoordinatorV2Mock, raffleEntranceFee, deployer, interval;
          const chainId = network.config.chainId;

          beforeEach(async function () {
              deployer = (await getNamedAccounts()).deployer;
              await deployments.fixture(["all"]);
              raffle = await ethers.getContract("Raffle", deployer);
              vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer);
              raffleEntranceFee = await raffle.getEntranceFee();
              interval = await raffle.getInterval();
          });

          describe("constructor", function () {
              it("Initializes the raffle correctly", async function () {
                  // ideally we'd only have 1 assert per "it"
                  const raffleState = await raffle.getRaffleState();
                  expect(raffleState.toString()).to.equal("0");
                  expect(interval.toString()).to.equal(networkConfig[chainId]["interval"]);
              });
          });

          describe("enterRaffle", function () {
              it("Reverts when you don't pay enough", async function () {
                  await expect(raffle.enterRaffle()).to.be.revertedWith(
                      "Raffle__NotEnoughEthEntered"
                  );
              });

              it("Records players when they enter", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  const playerFromContract = await raffle.getPlayer(0);
                  expect(playerFromContract).to.equal(deployer);
              });

              it("Emits event on enter", async function () {
                  expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.emit(
                      raffle,
                      "raffleEnter"
                  );
              });

              it("Doesn't allow entry when status is CALCULATING", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.send("evm_mine", []);
                  await raffle.performUpkeep([]);
                  await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWith(
                      "Raffle__NotOpen"
                  );
              });
          });

          describe("checkUpkeep", function () {
              it("Returns false if no on has sent ETH", async function () {
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.send("evm_mine", []);
                  await raffle.checkUpkeep([]);
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([]);
                  expect(upkeepNeeded).to.equal(false);
              });

              it("Returns false if raffle isn't open", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.send("evm_mine", []);
                  await raffle.performUpkeep([]);
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([]);
                  const raffleState = await raffle.getRaffleState();
                  expect(upkeepNeeded).to.equal(false);
                  expect(raffleState.toString()).to.equal("1");
              });

              it("Returns false if not enough time has passed", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([]);
                  expect(upkeepNeeded).to.equal(false);
              });

              it("Returns true if enough time has passed, has players, has ETH, status is OPEN", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.send("evm_mine", []);
                  const status = await raffle.getRaffleState();
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([]);
                  expect(status).to.equal(0);
                  expect(upkeepNeeded).to.equal(true);
              });
          });
          describe("performUpkeep", function () {
              it("Can only run if checkUpkeep is true", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.send("evm_mine", []);
                  const tx = await raffle.performUpkeep([]);
                  // assert(tx) will fail if the tx fails/ reverts
                  assert(tx);
              });

              it("Reverts when checkUpkeep is false", async function () {
                  await expect(raffle.performUpkeep([])).to.be.revertedWith(
                      "Raffle__UpkeepNotNeeded"
                  );
              });

              it("Updates the state, emits an event, and calls the vrfCoordinator", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.send("evm_mine", []);
                  const txResponse = await raffle.performUpkeep([]);
                  const txReceipt = await txResponse.wait(1);
                  // how to extract a value from an event:
                  const requestId = txReceipt.events[1].args.requestId;
                  const raffleState = await raffle.getRaffleState();
                  expect(raffleState.toString()).to.equal("1");
                  expect(txResponse).to.emit(raffle, "requestedRaffleWinner");
                  assert(requestId.toNumber() > 0);
              });
          });
          describe("fulfillRandomWords", function () {
              beforeEach(async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.send("evm_mine", []);
              });
              it("Can only be called after performUpkeep", async function () {
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)
                  ).to.be.revertedWith("nonexistent request");
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)
                  ).to.be.revertedWith("nonexistent request");
              });

              // way too big for a single unit test
              it("Picks the winner, resets the raffle, and sends money", async function () {
                  const additionalEntrants = 3;
                  const startingAccountIndex = 1; // deployer = 0
                  const accounts = await ethers.getSigners();
                  for (
                      let i = startingAccountIndex;
                      i < startingAccountIndex + additionalEntrants;
                      i++
                  ) {
                      const accountConnectedRaffle = raffle.connect(accounts[i]);
                      await accountConnectedRaffle.enterRaffle({ value: raffleEntranceFee });
                  }
                  const startingTimestamp = await raffle.getLatestTimestamp();
                  // performUpkeep (mock)
                  // fulfillRandomWords (mock)
                  // wait for fulfillRandomWords to be called
                  // so we need to create a listener/ promise

                  // all our code needs to be inside this promise
                  // but outside of raffle.once
                  await new Promise(async (resolve, reject) => {
                      // listener
                      raffle.once("winnerPicked", async () => {
                          console.log("Found the WinnerPicked event!");
                          try {
                              const recentWinner = await raffle.getRecentWinner();
                              const raffleState = await raffle.getRaffleState();
                              const endingTimeStamp = await raffle.getLatestTimestamp();
                              const numPlayers = await raffle.getNumberOfPlayers();
                              const winnerEndingBalance = await accounts[1].getBalance();
                              expect(numPlayers.toString()).to.equal("0");
                              expect(raffleState.toString()).to.equal("0");
                              assert(endingTimeStamp > startingTimestamp);
                              expect(winnerEndingBalance.toString()).to.equal(
                                  winnerStartingBalance.add(
                                      raffleEntranceFee.mul(additionalEntrants + 1).toString()
                                  )
                              );
                              console.log(recentWinner);
                              console.log(accounts[0].address);
                              console.log(accounts[1].address);
                              console.log(accounts[2].address);
                              console.log(accounts[3].address);
                              // we see that account 1 is the winner,
                              // so we'll get their starting balance below
                              resolve();
                          } catch (e) {
                              reject(e);
                          }
                      });
                      // fire the event below
                      const tx = await raffle.performUpkeep([]);
                      const txReceipt = await tx.wait(1);
                      const winnerStartingBalance = await accounts[1].getBalance();
                      await vrfCoordinatorV2Mock.fulfillRandomWords(
                          txReceipt.events[1].args.requestId,
                          raffle.address
                      );
                  });
              });
          });
      });
