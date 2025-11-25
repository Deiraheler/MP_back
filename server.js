import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { connectToDatabase } from "./config/db.js";
import authRoutes from "./src/routes/auth.routes.js";
import userRoutes from "./src/routes/users.routes.js";
import metadataRoutes from "./src/routes/metadata.routes.js";
import templatesRoutes from "./src/routes/templates.routes.js";
import appointmentsRoutes from "./src/routes/appointments.routes.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const port = process.env.PORT || 5000;
const env = process.env.NODE_ENV || "development";
const mongoUrl = process.env.MONGODB_URL;

app.get("/", (req, res) => {
  res.json({
    message: "Server is running",
    port,
    environment: env,
    mongoConfigured: Boolean(mongoUrl),
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/metadata", metadataRoutes);
app.use("/api/templates", templatesRoutes);
app.use("/api/appointments", appointmentsRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  if (err.statusCode) {
    // ApiError instance
    return res.status(err.statusCode).json({ message: err.message });
  }
  // Unexpected errors
  console.error("Unexpected error:", err);
  return res.status(500).json({ message: "Internal server error" });
});

connectToDatabase(mongoUrl)
  .then(() => {
    app.listen(port, () =>
      console.log(`🚀 Server running in ${env} mode on port ${port}`)
    );
  })
  .catch((err) => {
    console.error("Failed to connect to MongoDB:", err.message);
    process.exit(1);
  });