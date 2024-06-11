import "dotenv/config";

export default {
    jwtSecret: process.env.JWT_SECRET as string,
    nomlandPrivateKey: process.env.PRI_KEY as `0x${string}`,
};
