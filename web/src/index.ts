import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import "dotenv/config";

import connectDatabase from "./config/database";
import errorMiddleware from "./middlewares/error";
import activityRoutes from "./routes/activity";
import balanceRoutes from "./routes/balance";
import userRoutes from "./routes/users";

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET is not set. Refusing to start.");
}

const app = express();
const PORT = process.env.PORT || 4000;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

// Middleware
// The auth cookie is only sent cross-origin when the allowed origin is explicit
// and credentials are enabled, so a wildcard origin will not work here.
app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(cookieParser());
app.use(express.json());

// Routes
app.use("/activity", activityRoutes);
app.use("/balance", balanceRoutes);
app.use("/user", userRoutes);

// Health check
app.get("/", (req, res) => {
  res.json({ message: "Backend is running!" });
});

app.use(errorMiddleware);

// Start server
connectDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
});
