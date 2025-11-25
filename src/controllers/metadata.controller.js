import { CLINICIAN_PROFESSIONS } from "../models/User.js";
import { TEMPLATE_TYPES } from "../models/Template.js";
import { getBusinesses, getUserClinikoCredentials } from "../services/cliniko.service.js";
import catchAsync from "../utils/catchAsync.js";
import ApiError from "../utils/ApiError.js";

export async function getProfessions(req, res) {
  return res.json({ professions: CLINICIAN_PROFESSIONS });
}

export async function getTemplateTypes(req, res) {
  return res.json({ types: TEMPLATE_TYPES });
}

/**
 * Fetch businesses from Cliniko using provided API key or stored API key
 */
export const fetchBusinesses = catchAsync(async (req, res) => {
  const { apiKey, region, useStoredKey } = req.body;
  let apiKeyToUse = apiKey;
  let regionToUse = region;

  console.log("[metadata] /metadata/businesses called", {
    useStoredKey,
    hasApiKeyInBody: !!apiKey,
    bodyRegion: region,
    userId: req.user?._id?.toString?.(),
  });

  // If useStoredKey is true, get API key from user settings
  if (useStoredKey) {
    if (!req.user || !req.user._id) {
      throw new ApiError(401, "Authentication required");
    }

    const credentials = await getUserClinikoCredentials(req.user._id);
    if (!credentials || !credentials.apiKey) {
      throw new ApiError(400, "No API key found in settings. Please enter an API key first.");
    }

    apiKeyToUse = credentials.apiKey;
    regionToUse = credentials.region; // Use stored region

    console.log("[metadata] using stored Cliniko credentials", {
      regionFromSettings: credentials.region,
    });
  } else {
    if (!apiKey) {
      throw new ApiError(400, "API key is required");
    }
    // If region not provided, try to detect it from API key
    if (!region) {
      const { extractRegionFromApiKey } = await import("../utils/clinikoRegion.js");
      try {
        regionToUse = extractRegionFromApiKey(apiKey);
        console.log("[metadata] detected region from API key", { regionToUse });
      } catch (error) {
        // If region detection fails, throw error
        console.error("[metadata] failed to detect region from API key", error?.message);
        throw new ApiError(400, error.message || "Could not extract region from API key. Please provide the region or check the key format.");
      }
    } else {
      regionToUse = region;
    }
  }

  try {
    console.log("[metadata] fetching businesses via cliniko.service", {
      regionToUse,
      apiKeyLength: typeof apiKeyToUse === "string" ? apiKeyToUse.length : null,
      apiKeyPreview: typeof apiKeyToUse === "string" ? `${apiKeyToUse.substring(0, 10)}...${apiKeyToUse.slice(-10)}` : null,
    });
    
    const businesses = await getBusinesses(apiKeyToUse, regionToUse);
    
    console.log("[metadata] received businesses from service", {
      count: businesses?.length || 0,
      businesses: businesses,
    });
    
    if (!businesses || businesses.length === 0) {
      console.log("[metadata] no businesses found");
      return res.status(200).json({ 
        businesses: [],
        message: "No businesses found" 
      });
    }

    console.log("[metadata] returning businesses to client", {
      count: businesses.length,
    });

    return res.json({ businesses });
  } catch (error) {
    console.error("[metadata] error fetching businesses", {
      error: error.message,
      stack: error.stack,
      name: error.name,
    });
    throw new ApiError(400, error.message || "Failed to fetch businesses. Please check your API key.");
  }
});
