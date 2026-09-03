import { ErrorRequestHandler } from "express";
import ErrorHandler from "../utils/errorHandler";

/**
 * Final error handler. Must be registered after all routes.
 */
const errorMiddleware: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ErrorHandler) {
    res.status(err.statusCode).json({ success: false, message: err.message });
    return;
  }

  if (err?.name === "JsonWebTokenError" || err?.name === "TokenExpiredError") {
    res.status(401).json({ success: false, message: "Please Login to Access" });
    return;
  }

  // Messages from unexpected errors can carry connection strings and driver
  // internals, so they are logged rather than returned.
  console.error(err);
  res.status(500).json({ success: false, message: "Internal Server Error" });
};

export default errorMiddleware;
