/**
 * Valid Cliniko shards according to documentation
 * Region	Shard
 * AU	au1, au2, au3, au4, au5
 * CA	ca1
 * UK	uk1, uk2, uk3
 * EU	eu1
 */
const VALID_SHARDS = [
  "au1", "au2", "au3", "au4", "au5",
  "ca1",
  "uk1", "uk2", "uk3",
  "eu1",
];

/**
 * Extract shard from API key by taking the last 3-4 characters
 * Cliniko API keys end with shard codes like "-eu1", "-au1", "-au2", etc.
 * Validates against allowed shards and regex /\w{2}\d{1,2}/i
 * @param {string} apiKey - The Cliniko API key
 * @returns {string} - Detected shard (e.g., "eu1", "au1", "au2")
 */
function parseShardFromKey(apiKey) {
  if (!apiKey) {
    throw new Error("API key is required");
  }

  console.log("[clinikoRegion] extractRegionFromApiKey called", {
    keyLength: apiKey.length,
    last3Chars: apiKey.slice(-3),
    last4Chars: apiKey.slice(-4),
    last10Chars: apiKey.slice(-10),
  });

  // Try to extract shard from the end of the key
  // Shards match pattern: 2 letters + 1-2 digits (e.g., "eu1", "au2", "uk10")
  // Check last 3 characters first (most common: "eu1", "au1", etc.)
  const last3Chars = apiKey.slice(-3).toLowerCase();
  const last4Chars = apiKey.slice(-4).toLowerCase();
  
  // Validate against regex /\w{2}\d{1,2}/i
  const shardRegex = /^[a-z]{2}\d{1,2}$/i;
  
  let shard = null;
  
  // Try last 3 characters first
  if (shardRegex.test(last3Chars)) {
    shard = last3Chars;
    console.log("[clinikoRegion] extracted shard from last 3 chars", { shard });
  } 
  // Try last 4 characters (for cases like "uk10" if they exist)
  else if (shardRegex.test(last4Chars)) {
    shard = last4Chars;
    console.log("[clinikoRegion] extracted shard from last 4 chars", { shard });
  }
  
  if (!shard) {
    console.error("[clinikoRegion] could not extract valid shard", { 
      last3Chars, 
      last4Chars,
      matchesRegex3: shardRegex.test(last3Chars),
      matchesRegex4: shardRegex.test(last4Chars),
    });
    throw new Error(`Could not extract shard from API key. Last characters do not match shard pattern (2 letters + 1-2 digits).`);
  }

  // Validate against allowed shards list
  if (!VALID_SHARDS.includes(shard)) {
    console.error("[clinikoRegion] shard not in allowed list", { 
      shard, 
      validShards: VALID_SHARDS 
    });
    throw new Error(`Shard "${shard}" is not in the allowed list. Valid shards: ${VALID_SHARDS.join(", ")}`);
  }

  console.log("[clinikoRegion] validated shard", { shard, validShards: VALID_SHARDS });
  return shard;
}

/**
 * Extract shard from API key
 * Returns the full shard (e.g., "eu1", "au1", "au2") that should be used directly in API calls
 * @param {string} apiKey - The Cliniko API key
 * @returns {string} - Detected shard (e.g., "eu1", "au1", "au2")
 */
export function extractRegionFromApiKey(apiKey) {
  if (!apiKey) {
    throw new Error("API key is required");
  }

  return parseShardFromKey(apiKey);
}

export { VALID_SHARDS };
