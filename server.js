import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const port = process.env.PORT || 5000;
const env = process.env.NODE_ENV;

app.get("/", (req, res) => {
  res.json({
    message: "Server is running",
    port,
    environment: env,
    mongo: process.env.MONGO_URI,
  });
});

app.listen(port, () =>
  console.log(`🚀 Server running in ${env} mode on port ${port}`)
);