import { UserData } from "../Interfaces/AllInterfaces";
import { Response, Request, NextFunction } from "express";
import UserModels from "../Models/UserModels";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import WalletModels from "../Models/WalletModels";
import mongoose from "mongoose";
import HistoryModels from "../Models/HistoryModels";
import otpgenerator from "otp-generator";
import { AsyncHandler } from "../Utils/AsyncHandler";
import { HTTPCODES, MainAppError } from "../Utils/MainAppError";
import { InsufficientFunds, VerifyUsers } from "../Emails/Emails";

// Get all users
export const GetAllUsers = AsyncHandler(
  async (req: Request<{}, {}, UserData>, res: Response): Promise<Response> => {
    try {
      const AllUsers = await UserModels.find().sort({ createdAt: -1 });
      return res.status(HTTPCODES.OK).json({
        message: "Successfully got all users",
        data: AllUsers,
      });
    } catch (error) {
      return res.status(HTTPCODES.NOT_FOUND).json({
        message: "Couldn't get all users",
        data: error,
      });
    }
  }
);

// Get One users
export const GetOneUser = AsyncHandler(
  async (req: Request, res: Response): Promise<Response> => {
    try {
      const Auser = await UserModels.findById(req.params.userID);

      return res.status(HTTPCODES.OK).json({
        message: "Successfully got this user",
        data: Auser,
      });
    } catch (error) {
      return res.status(HTTPCODES.BAD_REQUEST).json({
        message: "Couldn't get this user",
        data: error,
      });
    }
  }
);

// RegisterUsers
export const RegisterUsers = AsyncHandler(
  async (
    req: Request<{}, {}, UserData>,
    res: Response,
    next: NextFunction
  ): Promise<Response> => {
    try {
      const { name, email, password, phoneNumber, userName } = req.body;

      const saltedPassword = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, saltedPassword);

      const dater = Date.now();
      console.log(dater);

      const num = 234;

      const user = await UserModels.create({
        name,
        email,
        userName,
        phoneNumber: num + phoneNumber,
        password: hashedPassword,
        verified: false,
        accountNumber: otpgenerator.generate(10, {
          upperCaseAlphabets: false,
          specialChars: false,
          digits: true,
          lowerCaseAlphabets: false,
        }),
      });

      const userWallet = await WalletModels.create({
        _id: user?._id,
        Owner: user?.name,
        Balance: 1000,
        credit: 0,
        debit: 0,
      });

      VerifyUsers(user);

      user?.wallet.push(new mongoose.Types.ObjectId(userWallet?._id));
      user.save();

      return res.status(HTTPCODES.OK).json({
        message: "Successfully created user",
        data: user,
        token: jwt.sign(
          { _id: user._id },
          "dhfufrr-fhfrgshcuiei-vriisiwowuhcb"
        ),
      });
    } catch (error) {
      return res.status(HTTPCODES.NOT_FOUND).json({
        message: "An error occured",
        data: error,
      });
    }
  }
);

// Users Verification:
export const UsersVerification = AsyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const { userID } = req.params;
    const User = await UserModels.findByIdAndUpdate(
      userID,
      {
        TOKEN: "",
        verified: true,
      },
      { new: true }
    );

    if (User) {
      return res.status(HTTPCODES.OK).json({
        message: "User Verification Successfull, proceed to login",
        data: User,
      });
    } else {
      next(
        new MainAppError({
          message: "Verification failed",
          httpcode: HTTPCODES.BAD_REQUEST,
        })
      );
    }
  }
);

// Login:
export const LoginUsers = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    const getuser = await UserModels.findOne({ email });

    const check = await bcrypt.compare(password, getuser!.password);

    if (getuser && check) {
      if (getuser?.verified && getuser?.TOKEN === "") {
        return res.status(200).json({
          message: "Login successfull",
          data: `Welcome ${getuser?.name}`,
          Userdata: getuser,
          TOKEN: jwt.sign(
            { _id: getuser?.id },
            "dhvvv222kfufueueueufueieieifduycyue",
            { expiresIn: 5 }
          ),
        });
      } else {
        return res.status(HTTPCODES.SERVICE_UNAVAILABLE).json({
          message: "User not verified",
        });
      }
    } else {
      return res.status(HTTPCODES.NOT_FOUND).json({
        message: "User does not exist",
      });
    }
  } catch (error) {
    return res.status(HTTPCODES.BAD_REQUEST).json({
      message: "Couldn't log in users",
      data: error,
    });
  }
};

// Function that handles the notification process when an automated
// deposit fails due to insufficient funds in a user's wallet.:
export const MakeDeposit = AsyncHandler(
  async (req: Request, res: Response): Promise<Response> => {
    try {
      const { accountNumber, amount } = req.body;
      const money: number = parseInt(amount);
      // Get date of the transaction
      const TransferDate = new Date();

      // This will genrate a transaction reference number
      const GenerateTransactionReference =
        Math.floor(Math.random() * 6745689743) + 243;

      // RECEIVER ACCOUNT:
      const getReciever = await UserModels.findOne({ accountNumber });

      const getRecieverWallet = await WalletModels.findById(getReciever?._id);

      // SENDER ACCOUNT:
      const getUser = await UserModels.findById(req.params.userID).populate({
        path: "wallet",
      });
      getUser?.wallet?.map((value: any) => {
        console.log("value", value?.Date);
      });

      const getUserWallet = await WalletModels.findById(req.params.walletID);
      console.log("here", getUser?.NotificationType);

      if (getUser && getReciever) {
        if (amount > getUserWallet?.Balance!) {
          InsufficientFunds(getUser, money);
          return res.status(HTTPCODES.BAD_REQUEST).json({
            message: "Insufficient Funds",
            NotificationType: "Email Notification",
          });
        } else {
          // Avoid user sending my money to my account that is prevent crediting yourself
          if (getUser?.accountNumber === accountNumber) {
            return res.status(HTTPCODES.REDIRECTED).json({
              message:
                "This is your account!!!...You can't transfer funds to yourself from this wallet",
            });
          } else {
            // Updating the sender wallet to receive the debit alert
            await WalletModels.findByIdAndUpdate(
              getUserWallet?._id,
              {
                Balance: getUserWallet?.Balance! - money,
                Date: TransferDate,
                credit: 0,
                debit: amount,
              },
              // to see the changes immediately
              { new: true }
            );
            console.log("Sender debit amount: ", getUserWallet?.Balance!);
            // Create the receipt/history of your transaction:
            const createSenderHistory = await HistoryModels.create({
              message: `You have sent ${money} to ${getReciever.name} on ${TransferDate}`,
              transactionReference: GenerateTransactionReference,
              transactionType: "Debit",
            });

            getUser.history.push(
              new mongoose.Types.ObjectId(createSenderHistory?._id)
            );
            getUser.save();

            // Updating the receiver wallet to receive the credit alert:
            await WalletModels.findByIdAndUpdate(getRecieverWallet?._id, {
              Balance: getRecieverWallet?.Balance! + money,
              Date: TransferDate,
              credit: money,
              debit: 0,
            });
            console.log(
              "Receiver credit amount: ",
              typeof getRecieverWallet?.Balance,
              typeof money
            );
            // Create the credit alert message for the receiver:
            const createReceiverHistory = await HistoryModels.create({
              message: `An amount of ${money} has been sent to you by ${getUser.name} on ${TransferDate}`,
              transactionReference: GenerateTransactionReference,
              transactionType: "Credit",
            });

            getReciever.history.push(
              new mongoose.Types.ObjectId(createReceiverHistory?._id)
            );
            getReciever?.save();
          }
        }
        return res.status(HTTPCODES.OK).json({
          message: "Transaction Successfull",
          TransactionDetails: `You have sent ${money} to ${getReciever.name} on ${TransferDate}`,
          Balance: `Your Account Balance is remaining ${getUserWallet?.Balance}`,
          NoticationType: "Email Notification",
        });
      } else {
        return res.status(HTTPCODES.NOT_FOUND).json({
          message: "Account not found",
        });
      }
    } catch (error) {
      return res.status(HTTPCODES.NOT_FOUND).json({
        message: "An error occured",
        data: error,
      });
    }
  }
);

// Fund your wallet from your bank

export const FundWalletFromBank = async (req: Request, res: Response) => {
  try {
    const getUserBank = await UserModels.findById(req.params.userID);

    const getUserWallet = await WalletModels.findById(req.params.walletID);

    const { amount, transactionRef } = req.body;

    await WalletModels.findByIdAndUpdate(getUserWallet?._id, {
      Balance: getUserWallet?.Balance + amount,
    });

    // Get receipt for my transfer from bank to wallet
    const WalletCreditReceipt = await HistoryModels.create({
      message: `An amount of ${amount} has been credited to your wallet from your bank`,
      transactionType: "Credit",
      transactionReference: transactionRef,
    });

    // Pushing in the receipt to the user
    getUserBank?.history?.push(
      new mongoose.Types.ObjectId(WalletCreditReceipt?._id)
    );

    return res.status(HTTPCODES.OK).json({
      message: "Wallet credit successfuully",
      data: WalletCreditReceipt,
    });
  } catch (error) {
    return res.status(HTTPCODES.BAD_GATEWAY).json({
      message: "An error occured",
      data: error,
    });
  }
};
