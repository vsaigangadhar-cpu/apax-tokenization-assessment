import { CookieOptions, Response } from "express";
import { IUser } from "../models/userModel";

const sendToken = (user: IUser, statusCode: number, res: Response) => {
  const token = user.getJWTToken();

  const options: CookieOptions = {
    expires: new Date(
      Date.now() +
        Number(process.env.COOKIE_EXPIRE ?? 7) * 24 * 60 * 60 * 1000
    ),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  };

  // Login reads the user with `+password`, so the document must never be
  // serialised wholesale.
  res.status(statusCode).cookie("token", token, options).json({
    success: true,
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email,
      role: user.role,
    },
    token,
  });
};

export default sendToken;
