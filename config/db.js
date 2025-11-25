import mongoose from "mongoose";

export async function connectToDatabase(mongoUrl) {
  if (!mongoUrl) {
    throw new Error("MONGODB_URL is not defined");
  }
  mongoose.set("strictQuery", true);
  await mongoose.connect(mongoUrl);
  return mongoose.connection;
}


