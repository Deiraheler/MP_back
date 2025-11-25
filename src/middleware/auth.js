import { verifyToken } from "../utils/jwt.js";
import { User } from "../models/User.js";

export async function authRequired(req, res, next) {
  try {
    const header = req.headers["authorization"] || "";
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const decoded = verifyToken(token);

    // Our access tokens currently store the user id under "_id"
    // but older tokens might use "userId". Support both for safety.
    const userId = decoded.userId || decoded._id || decoded.id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await User.findById(userId).select("_id firstName lastName email profession");
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Unauthorized" });
  }
}


