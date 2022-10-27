const { assert, expect } = require("chai");
const { getNamedAccounts, deployments, ethers, network } = require("hardhat");
const { developmentChains, networkConfig } = require("../../helper-hardhat-config");
const { describe, beforeEach, it } = require("mocha");

developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle Staging Test", function () {
          let raffle, raffleEntranceFee, deployer;

          beforeEach(async function () {
              deployer = (await getNamedAccounts()).deployer;
              raffle = await ethers.getContract("Raffle", deployer);
              raffleEntranceFee = await raffle.getEntranceFee();
          });
          describe("fulfillRandomWords", function () {
              it("Works with live Chainlink Keepers and live Chainlink VRF/ gives random winner", async function () {
                  console.log("Setting up test...");
                  const startingTimestamp = await raffle.getLatestTimestamp();
                  console.log(`startingTimestamp: ${startingTimestamp.toString()}`);
                  const accounts = await ethers.getSigners();
                  console.log(`accounts[0]: ${accounts[0].address}`);

                  console.log("Setting up Listener...");
                  await new Promise(async (resolve, reject) => {
                      // set up the listener before we enter the raffle
                      raffle.once("winnerPicked", async () => {
                          console.log("winnerPicked event fired!");
                          try {
                              // asserts go here
                              const recentWinner = await raffle.getRecentWinner();
                              console.log(`recentWinner: ${recentWinner}`);
                              const raffleState = await raffle.getRaffleState();
                              console.log(`raffleState: ${raffleState}`);
                              const winnerEndingBalance = await accounts[0].getBalance();
                              console.log(`winnerEndingBalance: ${winnerEndingBalance.toString()}`);
                              const endingTimestamp = await raffle.getLatestTimestamp();
                              console.log(`endingTimestamp: ${endingTimestamp}`);

                              // one  way to check if the raffle has been reset:
                              // await expect(raffle.getPlayer(0)).to.be.reverted;
                              assert.equal(recentWinner.toString(), accounts[0].address);
                              assert.equal(raffleState, 0);
                              assert.equal(
                                  winnerEndingBalance.toString(),
                                  winnerStartingBalance.add(raffleEntranceFee).toString()
                              );
                              assert(endingTimestamp > startingTimestamp);
                              resolve();
                          } catch (error) {
                              console.log(error);
                              reject(error);
                          }
                      });
                      //enter the raffle here
                      console.log("Entering the raffle");
                      const tx = await raffle.enterRaffle({ value: raffleEntranceFee });
                      console.log("OK time to wait...");
                      const txReceipt = await tx.wait(1);
                      console.log(txReceipt);
                      const winnerStartingBalance = await accounts[0].getBalance();
                      console.log(`winnerStartingBalance: ${winnerStartingBalance.toString()}`);
                  });
              });
          });
      });
