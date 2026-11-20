import { z } from "zod";

const mySchema = z
  .object({
    myString: z.string().min(5),
    myUnion: z.union([z.number(), z.boolean()]),
  })
  .describe("My neat object schema");

export const jsonSchema = z.toJSONSchema(mySchema);

