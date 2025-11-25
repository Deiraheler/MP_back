import clinikoAxios from "../utils/clinikoAxios.js";
import { decrypt } from "../utils/encryption.js";
import { UserSettings } from "../models/UserSettings.js";

/**
 * Get businesses from Cliniko API
 * @param {string} apiKey - Cliniko API key (encrypted or plain)
 * @param {string} region - Cliniko shard (e.g., 'eu1', 'au1', 'au2') - required
 * @returns {Promise<Array>} - Array of business objects
 */
async function getBusinesses(apiKey, region) {
  if (!region) {
    throw new Error("Shard is required");
  }
  try {
    console.log("[cliniko] getBusinesses called", {
      hasKey: !!apiKey,
      keyLength: typeof apiKey === "string" ? apiKey.length : null,
      hasLegacyPrefix: typeof apiKey === "string" && apiKey.startsWith("$$_"),
      region,
      keyPreview: typeof apiKey === "string" ? `${apiKey.substring(0, 10)}...${apiKey.slice(-10)}` : null,
    });

    // Decrypt API key if it's encrypted.
    // Supports both plain keys and legacy encrypted values starting with "$$_".
    let decryptedKey = apiKey;
    if (apiKey && apiKey.includes(":")) {
      console.log("[cliniko] attempting decryption", { hasColon: true });
      // Try to decrypt - decrypt() will return original if not encrypted
      decryptedKey = decrypt(apiKey);
    } else {
      console.log("[cliniko] skipping decryption", { reason: "no colon in key" });
    }

    const decryptionChanged = decryptedKey !== apiKey;
    console.log("[cliniko] decryption result", {
      decryptionChanged,
      originalLength: typeof apiKey === "string" ? apiKey.length : null,
      decryptedLength: typeof decryptedKey === "string" ? decryptedKey.length : null,
      decryptedPreview: typeof decryptedKey === "string" ? `${decryptedKey.substring(0, 10)}...${decryptedKey.slice(-10)}` : null,
    });

    // If the key looks like a legacy encrypted value ("$$_…") and decryption
    // failed (decrypt returned the original), do NOT send it to Cliniko.
    // Using the encrypted blob as the username would create a huge
    // Authorization header and trigger "400 Request Header Or Cookie Too Large".
    if (
      typeof apiKey === "string" &&
      apiKey.startsWith("$$_") &&
      decryptedKey === apiKey
    ) {
      console.error("[cliniko] legacy encrypted key could not be decrypted; aborting call");
      throw new Error(
        "Encrypted API key could not be decrypted. Please paste your plain Cliniko API key instead."
      );
    }

    // Create Basic Auth header
    const basicAuth = Buffer.from(`${decryptedKey}:`).toString("base64");
    console.log("[cliniko] created Basic Auth header", {
      basicAuthLength: basicAuth.length,
      basicAuthPreview: `${basicAuth.substring(0, 20)}...`,
    });

    // The region parameter should be the full shard (e.g., "eu1", "au1", "au2")
    // Use it directly as the API subdomain
    const shard = region.toLowerCase();
    
    // Validate shard format: should match /\w{2}\d{1,2}/i
    const shardRegex = /^[a-z]{2}\d{1,2}$/i;
    if (!shardRegex.test(shard)) {
      console.error("[cliniko] invalid shard format", { 
        shard,
        expectedFormat: "2 letters + 1-2 digits (e.g., eu1, au1, au2)",
      });
      throw new Error(`Invalid shard format: "${shard}". Shard must match pattern: 2 letters + 1-2 digits (e.g., eu1, au1, au2)`);
    }
    
    // Valid shards according to Cliniko documentation
    const validShards = [
      "au1", "au2", "au3", "au4", "au5",
      "ca1",
      "uk1", "uk2", "uk3",
      "eu1",
    ];
    
    if (!validShards.includes(shard)) {
      console.error("[cliniko] shard not in allowed list", { 
        shard,
        validShards,
      });
      throw new Error(`Invalid shard: "${shard}". Valid shards: ${validShards.join(", ")}`);
    }
    
    // Use shard directly as API subdomain (e.g., "eu1" -> "api.eu1.cliniko.com")
    const apiSubdomain = shard;

    const url = `https://api.${apiSubdomain}.cliniko.com/v1/businesses`;
    console.log("[cliniko] calling Cliniko businesses endpoint", {
      url,
      shard: region,
      apiSubdomain,
      fullUrl: url,
    });

    // Fetch businesses from Cliniko
    const response = await clinikoAxios(url, {
      method: "GET",
      headers: {
        Authorization: `Basic ${basicAuth}`,
      },
    });

    console.log("[cliniko] received response from Cliniko", {
      statusCode: response.status,
      hasData: !!response.data,
      dataKeys: response.data ? Object.keys(response.data) : null,
      businessesCount: response.data?.businesses?.length || 0,
    });

    // Extract businesses from response
    const businesses = response.data?.businesses || [];
    
    console.log("[cliniko] processing businesses", {
      rawCount: businesses.length,
      businesses: businesses.map(b => ({
        id: b.id,
        business_name: b.business_name,
        display_name: b.display_name,
        label: b.label,
        time_zone: b.time_zone,
      })),
    });
    
    const mappedBusinesses = businesses.map((business) => ({
      id: business.id?.toString() || "",
      // Use display_name if available, fallback to business_name, then label
      name: business.display_name || business.business_name || business.label || "",
      timezone: business.time_zone || business.timezone || "",
    }));

    console.log("[cliniko] returning mapped businesses", {
      count: mappedBusinesses.length,
      businesses: mappedBusinesses,
    });

    return mappedBusinesses;
  } catch (error) {
    console.error("[cliniko] error fetching businesses from Cliniko", {
      error: error.message,
      stack: error.stack,
      name: error.name,
    });
    throw error;
  }
}

/**
 * Get user's Cliniko API key and shard from settings
 * @param {string} userId - User ID
 * @returns {Promise<{apiKey: string, region: string}>} - region is actually the shard (e.g., "eu1", "au1")
 */
async function getUserClinikoCredentials(userId) {
  const settings = await UserSettings.findOne({ user: userId }).lean();
  if (!settings || !settings.apiKey) {
    return null;
  }

  // Decrypt API key
  const decryptedKey = decrypt(settings.apiKey);
  
  // Use stored shard (stored as apiRegion in DB) - must be present (extracted from API key when saved)
  if (!settings.apiRegion) {
    throw new Error("API shard not found in settings. Please update your API key to extract the shard.");
  }

  return {
    apiKey: decryptedKey,
    region: settings.apiRegion, // This is actually the shard (e.g., "eu1", "au1")
  };
}

/**
 * Get practitioner details including Basic Auth header, API shard, and business ID
 * This matches the pattern used in the example code
 * @param {string} userId - User ID
 * @returns {Promise<{basicAuth: string, apiRegion: string, businessId: string}>} - apiRegion is actually the shard (e.g., "eu1", "au1")
 */
async function getPractitionerDetails(userId) {
  const settings = await UserSettings.findOne({ user: userId }).lean();
  if (!settings || !settings.apiKey) {
    return null;
  }

  // Decrypt API key
  const decryptedKey = decrypt(settings.apiKey);
  
  // Use stored shard (stored as apiRegion in DB) - must be present (extracted from API key when saved)
  if (!settings.apiRegion) {
    throw new Error("API shard not found in settings. Please update your API key to extract the shard.");
  }

  // Create Basic Auth header (format: "Basic base64(apiKey:)")
  const basicAuth = `Basic ${Buffer.from(`${decryptedKey}:`).toString("base64")}`;

  return {
    basicAuth,
    apiRegion: settings.apiRegion, // This is actually the shard (e.g., "eu1", "au1")
    businessId: settings.business || null,
    practitionerId: settings.practitionerId || null,
  };
}

/**
 * Get practitioners from Cliniko API
 * @param {string} apiKey - Cliniko API key (encrypted or plain)
 * @param {string} region - Cliniko shard (e.g., 'eu1', 'au1', 'au2') - required
 * @returns {Promise<Array>} - Array of practitioner objects with email
 */
async function getPractitioners(apiKey, region) {
  if (!region) {
    throw new Error("Shard is required");
  }

  try {
    console.log("[cliniko] getPractitioners called", {
      hasKey: !!apiKey,
      region,
    });

    // Decrypt API key if needed
    let decryptedKey = apiKey;
    if (apiKey && apiKey.includes(":")) {
      decryptedKey = decrypt(apiKey);
    }

    // Create Basic Auth header
    const basicAuth = Buffer.from(`${decryptedKey}:`).toString("base64");

    // Validate and use shard
    const shard = region.toLowerCase();
    const shardRegex = /^[a-z]{2}\d{1,2}$/i;
    if (!shardRegex.test(shard)) {
      throw new Error(`Invalid shard format: "${shard}"`);
    }

    const validShards = [
      "au1", "au2", "au3", "au4", "au5",
      "ca1",
      "uk1", "uk2", "uk3",
      "eu1",
    ];
    
    if (!validShards.includes(shard)) {
      throw new Error(`Invalid shard: "${shard}"`);
    }

    // Fetch all practitioners (no business filter available in API)
    const url = `https://api.${shard}.cliniko.com/v1/practitioners?page=1&per_page=100`;
    console.log("[cliniko] calling Cliniko practitioners endpoint", { url });

    const response = await clinikoAxios(url, {
      method: "GET",
      headers: {
        Authorization: `Basic ${basicAuth}`,
      },
    });

    const practitioners = response.data?.practitioners || [];
    console.log("[cliniko] received practitioners from Cliniko", {
      count: practitioners.length,
      practitionerIds: practitioners.map((p) => p.id),
    });

    // Fetch user details for each practitioner to get email
    const practitionersWithEmail = await Promise.all(
      practitioners.map(async (practitioner) => {
        let email = "";
        // Practitioner has a user link - fetch user to get email
        if (practitioner.user?.links?.self) {
          try {
            const userUrl = practitioner.user.links.self;
            const userResponse = await clinikoAxios(userUrl, {
              method: "GET",
              headers: {
                Authorization: `Basic ${basicAuth}`,
              },
            });
            email = userResponse.data?.email || "";
          } catch (error) {
            console.error(`[cliniko] error fetching user for practitioner ${practitioner.id}:`, error.message);
          }
        }

        return {
          id: practitioner.id?.toString() || "",
          firstName: practitioner.first_name || "",
          lastName: practitioner.last_name || "",
          email: email,
          displayName: practitioner.display_name || "",
        };
      })
    );

    console.log("[cliniko] practitioners with email", {
      count: practitionersWithEmail.length,
      practitioners: practitionersWithEmail.map((p) => ({
        id: p.id,
        email: p.email,
        name: p.displayName,
      })),
    });

    return practitionersWithEmail;
  } catch (error) {
    console.error("[cliniko] error fetching practitioners from Cliniko", {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Find practitioner ID by matching user email
 * @param {string} apiKey - Cliniko API key (encrypted or plain)
 * @param {string} region - Cliniko shard (e.g., 'eu1', 'au1', 'au2')
 * @param {string} userEmail - User email to match
 * @returns {Promise<string|null>} - Practitioner ID or null if not found
 */
async function findPractitionerByEmail(apiKey, region, userEmail) {
  if (!userEmail) {
    console.log("[cliniko] findPractitionerByEmail: no email provided");
    return null;
  }

  try {
    console.log("[cliniko] findPractitionerByEmail called", {
      userEmail,
      region,
    });

    const practitioners = await getPractitioners(apiKey, region);
    
    // Find practitioner with matching email (case-insensitive)
    const normalizedUserEmail = userEmail.toLowerCase().trim();
    const matchingPractitioner = practitioners.find((p) => {
      const practitionerEmail = (p.email || "").toLowerCase().trim();
      return practitionerEmail === normalizedUserEmail;
    });

    if (matchingPractitioner) {
      console.log("[cliniko] found matching practitioner", {
        practitionerId: matchingPractitioner.id,
        email: matchingPractitioner.email,
        name: matchingPractitioner.displayName || `${matchingPractitioner.firstName} ${matchingPractitioner.lastName}`,
      });
      return matchingPractitioner.id;
    }

    console.log("[cliniko] no matching practitioner found", {
      userEmail,
      checkedCount: practitioners.length,
      availableEmails: practitioners.filter((p) => p.email).map((p) => p.email),
    });
    return null;
  } catch (error) {
    console.error("[cliniko] error finding practitioner by email", {
      error: error.message,
      stack: error.stack,
    });
    // Don't throw - return null if we can't find it
    return null;
  }
}

export { getBusinesses, getUserClinikoCredentials, getPractitionerDetails, getPractitioners, findPractitionerByEmail };

