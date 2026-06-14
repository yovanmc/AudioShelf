import { describe, expect, it } from "vitest";
import { keepListeningPercent, percent, recommendationPercent } from "./home";

describe("Home progress", () => {
  it("returns zero for an empty total", () => {
    expect(percent(4, 0)).toBe(0);
  });

  it("rounds progress to a whole percent", () => {
    expect(percent(2, 3)).toBe(67);
  });

  it("adapts continuation and recommendation counts", () => {
    expect(
      keepListeningPercent({
        authorId: 1,
        authorName: "Alice",
        workId: 2,
        workTitle: "Tale",
        nextChapter: {
          id: 3,
          title: "Tale 2",
          chapterNo: 2,
          format: "mp3",
          durationSecs: 10,
          filePath: "tale.mp3",
          played: false,
          tags: [],
          labels: [],
          userSummary: "",
          takeaway: "",
          isFavorite: false,
          metadata: [],
          playbackPositionSecs: 0,
          hasJournal: false,
        },
        remainingUnplayed: 2,
        totalChapters: 4,
        playedChapters: 2,
        lastPlayedAt: 1,
      }),
    ).toBe(50);
    expect(
      recommendationPercent({
        workId: 4,
        baseTitle: "Blue",
        authorId: 5,
        authorName: "Bob",
        totalChapters: 5,
        unplayedCount: 4,
        tags: [],
        matchedTags: [],
        reason: "Mostly unplayed",
      }),
    ).toBe(20);
  });
});
