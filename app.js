SRS.init([...VOCAB_1_250, ...VOCAB_251_500]);
const card = SRS.getNextCard();
const result = SRS.recordAnswer(card.rank, 4);
const stats = SRS.getStats();
