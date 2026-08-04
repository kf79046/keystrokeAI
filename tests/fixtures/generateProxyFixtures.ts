type GenerateProxyRequest = {
  mode?: "words" | "time";
  count?: number;
  include_punctuation?: boolean;
  include_numbers?: boolean;
};

const WORDS = [
  "alpha",
  "bravo",
  "charlie",
  "delta",
  "echo",
  "foxtrot",
  "golf",
  "hotel",
  "india",
  "juliet",
  "kilo",
  "lima",
  "mango",
  "novel",
  "ocean",
  "piano",
  "queen",
  "river",
  "solar",
  "tiger",
];

export function deterministicGenerateProxyResponse(
  request: GenerateProxyRequest,
) {
  const count = request.mode === "time" ? 200 : Number(request.count ?? 15);
  const words = Array.from(
    { length: count },
    (_, index) => WORDS[index % WORDS.length],
  );
  const punctuation = request.include_punctuation === true;
  const numbers = request.include_numbers === true;

  return {
    text: words.join(" "),
    mode: request.mode ?? "words",
    count,
    seed: 9000 + Number(punctuation) * 10 + Number(numbers),
    difficulty: "medium",
    flags: {
      punctuation,
      numbers,
    },
  };
}
