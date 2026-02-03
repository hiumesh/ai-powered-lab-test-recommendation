import z from "zod";

export const patientSchema = z.object({
  age: z.coerce
    .number()
    .min(0, "Age must be valid")
    .max(120, "Age must be valid"),
  gender: z.enum(["M", "F"]),
  abnormal_tests: z
    .array(z.object({ value: z.string().min(1, "Test result required") }))
    .min(1, "At least one abnormal test is required"),
  symptoms: z.array(
    z.object({ value: z.string().min(1, "Symptom description required") }),
  ),
});
