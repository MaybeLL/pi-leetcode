// src/api/client.ts
import got from "got";
import { z as z3 } from "zod";
import { setTimeout as delay } from "timers/promises";

// src/api/jobs.ts
import { z } from "zod";
var ClientError = class extends Error {
  constructor(kind, message, outcomeUnknown = false) {
    super(message);
    this.kind = kind;
    this.outcomeUnknown = outcomeUnknown;
    this.name = "ClientError";
  }
};
var jobIdPattern = /^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/;
var JobResultSchema = z.object({
  state: z.enum(["SUCCESS", "FAILURE"]),
  status_code: z.number().int(),
  status_msg: z.string().optional(),
  run_success: z.boolean().optional(),
  correct_answer: z.boolean().optional(),
  total_correct: z.number().nullish().transform((value) => value ?? void 0),
  total_testcases: z.number().nullish().transform((value) => value ?? void 0),
  status_runtime: z.string().optional(),
  status_memory: z.string().optional(),
  runtime_percentile: z.number().nullable().optional(),
  memory_percentile: z.number().nullable().optional(),
  code_answer: z.array(z.string()).optional(),
  expected_code_answer: z.array(z.string()).optional(),
  code_output: z.union([z.string(), z.array(z.string())]).optional(),
  last_testcase_output: z.string().optional(),
  expected_output: z.string().optional(),
  std_output: z.string().optional(),
  std_output_list: z.array(z.string()).optional(),
  compile_error: z.string().optional(),
  full_compile_error: z.string().optional(),
  runtime_error: z.string().optional(),
  full_runtime_error: z.string().optional(),
  last_testcase: z.string().optional()
});
function clientError(error, mutation = false) {
  if (error instanceof ClientError) return error;
  const status = error?.response?.statusCode;
  if (status === 401) return new ClientError("auth", "Authentication required.");
  if (status === 403)
    return new ClientError("forbidden", "Access denied; browser verification may be required.");
  if (status === 429) return new ClientError("throttled", "Too many requests. Try later.");
  if (status && status >= 400)
    return new ClientError(
      "platform",
      `Platform request failed (HTTP ${status}).`,
      mutation && status >= 500
    );
  if (error?.name === "ParseError" || error instanceof z.ZodError)
    return new ClientError("protocol", "Invalid platform response.", mutation);
  return new ClientError(
    "network",
    mutation ? "Send outcome unknown; do not automatically resend." : "Platform connection failed.",
    mutation
  );
}
function options(signal) {
  if (signal?.aborted) throw new ClientError("cancelled", "Cancelled before request.");
  return { signal, retry: { limit: 0 }, followRedirect: false, timeout: { request: 2e4 } };
}
async function startJob(http, kind, request, opts = {}) {
  if (!/^[a-zA-Z0-9-]+$/.test(request.titleSlug) || !request.questionId || !request.lang)
    throw new ClientError("protocol", "Invalid problem or language.");
  const requestOptions = options(opts.signal);
  try {
    const response = await http.post(`problems/${request.titleSlug}/${kind === "run" ? "interpret_solution" : "submit"}/`, {
      ...requestOptions,
      json: {
        lang: request.lang,
        typed_code: request.code,
        question_id: request.questionId,
        ...kind === "run" ? { data_input: request.testcases } : {}
      }
    }).json();
    const id = response?.[kind === "run" ? "interpret_id" : "submission_id"];
    if (!(typeof id === "string" && jobIdPattern.test(id) || typeof id === "number" && Number.isSafeInteger(id) && id > 0))
      throw new ClientError("protocol", "Missing task ID; send outcome unknown.", true);
    return { id: String(id), kind };
  } catch (error) {
    throw clientError(error, true);
  }
}
async function checkJob(http, job, opts = {}) {
  if (!jobIdPattern.test(job.id) || !["run", "submit"].includes(job.kind))
    throw new ClientError("protocol", "Invalid job.");
  const requestOptions = options(opts.signal);
  try {
    const raw = await http.get(`submissions/detail/${job.id}/check/`, requestOptions).json();
    const state = raw?.state;
    if (state === "PENDING" || state === "STARTED") return { state: "pending" };
    const parsed = JobResultSchema.safeParse(raw);
    if (!parsed.success || ![10, 11, 12, 13, 14, 15, 16, 20].includes(parsed.data.status_code) || parsed.data.state === "FAILURE" && parsed.data.status_code === 10)
      throw new ClientError("protocol", "Unrecognized judge response; no success assumed.");
    return { state: "complete", result: parsed.data };
  } catch (error) {
    throw clientError(error);
  }
}

// src/schemas/api.ts
import { z as z2 } from "zod";
var TopicTagSchema = z2.object({
  name: z2.string(),
  slug: z2.string()
});
var CompanyTagSchema = z2.object({
  name: z2.string(),
  slug: z2.string()
});
var CodeSnippetSchema = z2.object({
  lang: z2.string(),
  langSlug: z2.string(),
  code: z2.string()
});
var ProblemSchema = z2.object({
  questionId: z2.string(),
  questionFrontendId: z2.string(),
  title: z2.string(),
  titleSlug: z2.string(),
  difficulty: z2.enum(["Easy", "Medium", "Hard"]),
  isPaidOnly: z2.boolean(),
  acRate: z2.number().optional().default(0),
  topicTags: z2.array(TopicTagSchema),
  status: z2.enum(["ac", "notac"]).nullable()
});
var ProblemDetailSchema = ProblemSchema.extend({
  content: z2.string().nullable(),
  codeSnippets: z2.array(CodeSnippetSchema).nullable(),
  sampleTestCase: z2.string(),
  exampleTestcases: z2.string(),
  exampleTestcaseList: z2.array(z2.string()).optional(),
  metaData: z2.string().optional(),
  hints: z2.array(z2.string()),
  companyTags: z2.array(CompanyTagSchema).nullable(),
  stats: z2.string()
});
var DailyChallengeSchema = z2.object({
  date: z2.string(),
  link: z2.string(),
  question: ProblemSchema
});
var CnDailyChallengeSchema = z2.object({
  todayRecord: z2.array(
    z2.object({
      date: z2.string().optional(),
      link: z2.string().optional(),
      question: z2.object({
        questionId: z2.union([z2.string(), z2.number()]).optional(),
        frontendQuestionId: z2.union([z2.string(), z2.number()]).optional(),
        questionFrontendId: z2.union([z2.string(), z2.number()]).optional(),
        difficulty: z2.string().nullable().optional(),
        title: z2.string().optional(),
        titleCn: z2.string().nullable().optional(),
        titleSlug: z2.string().optional(),
        paidOnly: z2.boolean().optional(),
        isPaidOnly: z2.boolean().optional(),
        acRate: z2.union([z2.number(), z2.string()]).optional(),
        status: z2.union([z2.literal("ac"), z2.literal("notac"), z2.null()]).optional(),
        topicTags: z2.array(
          z2.object({
            name: z2.string().nullable().optional(),
            nameTranslated: z2.string().nullable().optional(),
            id: z2.union([z2.string(), z2.number()]).nullable().optional()
          })
        ).nullable().optional()
      }).nullable().optional()
    })
  ).nullable().optional()
});
var CnProblemListSchema = z2.object({
  problemsetQuestionList: z2.object({
    total: z2.number(),
    questions: z2.array(
      z2.object({
        frontendQuestionId: z2.union([z2.string(), z2.number()]).optional(),
        title: z2.string().optional(),
        titleCn: z2.string().nullable().optional(),
        titleSlug: z2.string().optional(),
        difficulty: z2.string().nullable().optional(),
        paidOnly: z2.boolean().optional(),
        acRate: z2.union([z2.number(), z2.string()]).optional(),
        status: z2.string().nullable().optional(),
        topicTags: z2.array(
          z2.object({
            name: z2.string().nullable().optional(),
            nameTranslated: z2.string().nullable().optional(),
            id: z2.union([z2.string(), z2.number()]).nullable().optional(),
            slug: z2.string().nullable().optional()
          })
        ).nullable().optional()
      })
    )
  })
});
var CnProblemDetailSchema = z2.object({
  question: z2.object({
    questionId: z2.union([z2.string(), z2.number()]).optional(),
    questionFrontendId: z2.union([z2.string(), z2.number()]).optional(),
    title: z2.string().optional(),
    translatedTitle: z2.string().nullable().optional(),
    titleSlug: z2.string().optional(),
    translatedContent: z2.string().nullable().optional(),
    difficulty: z2.string().nullable().optional(),
    isPaidOnly: z2.boolean().optional(),
    acRate: z2.union([z2.number(), z2.string()]).optional(),
    status: z2.string().nullable().optional(),
    topicTags: z2.array(
      z2.object({
        name: z2.string().nullable().optional(),
        slug: z2.string().nullable().optional(),
        translatedName: z2.string().nullable().optional()
      })
    ).nullable().optional(),
    codeSnippets: z2.array(
      z2.object({
        lang: z2.string(),
        langSlug: z2.string(),
        code: z2.string()
      })
    ).nullable().optional(),
    sampleTestCase: z2.string().nullable().optional(),
    exampleTestcases: z2.string().nullable().optional(),
    exampleTestcaseList: z2.array(z2.string()).nullable().optional(),
    metaData: z2.string().nullable().optional(),
    hints: z2.array(z2.string()).nullable().optional(),
    stats: z2.string().nullable().optional()
  })
});
var ContestSchema = z2.object({
  title: z2.string(),
  titleSlug: z2.string(),
  startTime: z2.number(),
  duration: z2.number(),
  originStartTime: z2.number().nullable().optional(),
  isVirtual: z2.boolean().nullable().optional(),
  containsPremium: z2.boolean().nullable().optional()
});
var ContestQuestionSchema = z2.object({
  questionId: z2.union([z2.string(), z2.number()]).transform(String),
  title: z2.string(),
  titleSlug: z2.string(),
  difficulty: z2.enum(["Easy", "Medium", "Hard"]).nullable().optional()
});
var ContestDetailSchema = ContestSchema.extend({
  description: z2.string().nullable().optional(),
  questions: z2.array(ContestQuestionSchema)
});
var ContestListSchema = z2.object({
  allContests: z2.array(ContestSchema)
});
var CnContestHistorySchema = z2.object({
  contestHistory: z2.object({
    totalNum: z2.number(),
    contests: z2.array(
      ContestSchema.extend({
        description: z2.string().nullable().optional()
      })
    )
  })
});
var ContestDetailResponseSchema = z2.object({
  contest: ContestDetailSchema.nullable().optional()
});
var SubmissionSchema = z2.object({
  id: z2.string(),
  statusDisplay: z2.string(),
  lang: z2.string(),
  runtime: z2.string(),
  timestamp: z2.string(),
  memory: z2.string()
});
var SubmissionDetailsSchema = z2.object({
  code: z2.string(),
  runtime: z2.union([z2.number(), z2.string()]).optional().nullable(),
  runtimeDisplay: z2.string().optional().nullable(),
  runtimePercentile: z2.number().optional().nullable(),
  memory: z2.union([z2.number(), z2.string()]).optional().nullable(),
  memoryDisplay: z2.string().optional().nullable(),
  memoryPercentile: z2.number().optional().nullable(),
  statusDisplay: z2.string().optional().nullable(),
  lang: z2.object({ name: z2.string() }).nullable().optional()
});
var CnSubmissionDetailsSchema = SubmissionDetailsSchema.extend({
  lang: z2.string().nullable().optional()
}).transform(({ lang, ...details }) => ({
  ...details,
  lang: lang == null ? lang : { name: lang }
}));
var TestResultSchema = z2.object({
  status_code: z2.number(),
  status_msg: z2.string(),
  state: z2.string(),
  run_success: z2.boolean().optional(),
  code_answer: z2.array(z2.string()).optional(),
  expected_code_answer: z2.array(z2.string()).optional(),
  correct_answer: z2.boolean().optional(),
  std_output_list: z2.array(z2.string()).optional(),
  compile_error: z2.string().optional(),
  runtime_error: z2.string().optional()
});
var SubmissionResultSchema = z2.object({
  status_code: z2.number(),
  status_msg: z2.string(),
  state: z2.string(),
  run_success: z2.boolean().optional(),
  total_correct: z2.number().optional(),
  total_testcases: z2.number().optional(),
  status_runtime: z2.string().optional(),
  status_memory: z2.string().optional(),
  runtime_percentile: z2.number().nullable().optional(),
  memory_percentile: z2.number().nullable().optional(),
  code_output: z2.string().optional(),
  std_output: z2.string().optional(),
  expected_output: z2.string().optional(),
  compile_error: z2.string().optional(),
  runtime_error: z2.string().optional(),
  last_testcase: z2.string().optional()
});
var UserProfileSchema = z2.object({
  username: z2.string(),
  profile: z2.object({
    realName: z2.string(),
    ranking: z2.number()
  }),
  submitStatsGlobal: z2.object({
    acSubmissionNum: z2.array(
      z2.object({
        difficulty: z2.string(),
        count: z2.number()
      })
    )
  }),
  userCalendar: z2.object({
    streak: z2.number(),
    totalActiveDays: z2.number(),
    submissionCalendar: z2.string().optional()
  })
});
var CnUserProfileSchema = z2.object({
  userProfilePublicProfile: z2.object({
    siteRanking: z2.number().optional(),
    profile: z2.object({
      userSlug: z2.string().optional(),
      realName: z2.string().optional()
    }).optional()
  }).nullable().optional(),
  userProfileUserQuestionProgress: z2.object({
    numAcceptedQuestions: z2.array(
      z2.object({
        difficulty: z2.string().optional(),
        count: z2.number().optional()
      })
    ).optional()
  }).nullable().optional()
});
var CnSkillStatsSchema = z2.object({
  userProfilePublicProfile: z2.object({
    profile: z2.object({
      skillSet: z2.object({
        topicAreaScores: z2.array(
          z2.object({
            score: z2.number().optional(),
            topicArea: z2.object({
              name: z2.string().optional(),
              slug: z2.string().optional()
            }).nullable().optional()
          })
        ).optional()
      }).nullable().optional()
    }).nullable().optional()
  }).nullable().optional()
});
var UserStatusSchema = z2.object({
  userSlug: z2.string().nullable().optional(),
  isSignedIn: z2.boolean(),
  username: z2.string().nullable()
});

// src/api/queries.global.ts
var PROBLEM_LIST_QUERY = `
  query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
    problemsetQuestionList: questionList(
      categorySlug: $categorySlug
      limit: $limit
      skip: $skip
      filters: $filters
    ) {
      total: totalNum
      questions: data {
        questionId
        questionFrontendId
        title
        titleSlug
        difficulty
        isPaidOnly
        acRate
        topicTags {
          name
          slug
        }
        status
      }
    }
  }
`;
var PROBLEM_DETAIL_QUERY = `
  query questionData($titleSlug: String!) {
    question(titleSlug: $titleSlug) {
      questionId
      questionFrontendId
      title
      titleSlug
      content
      difficulty
      isPaidOnly
      topicTags {
        name
        slug
      }
      codeSnippets {
        lang
        langSlug
        code
      }
      sampleTestCase
      exampleTestcases
      exampleTestcaseList
      hints
      companyTags {
        name
        slug
      }
      stats
      status
    }
  }
`;
var USER_STATUS_QUERY = `
  query globalData {
    userStatus {
      isSignedIn
      username
    }
  }
`;
var USER_PROFILE_QUERY = `
  query userPublicProfile($username: String!) {
    matchedUser(username: $username) {
      username
      profile {
        realName
        ranking
      }
      submitStatsGlobal {
        acSubmissionNum {
          difficulty
          count
        }
      }
      userCalendar {
        streak
        totalActiveDays
        submissionCalendar
      }
    }
  }
`;
var SKILL_STATS_QUERY = `
  query skillStats($username: String!) {
    matchedUser(username: $username) {
      tagProblemCounts {
        fundamental {
          tagName
          tagSlug
          problemsSolved
        }
        intermediate {
          tagName
          tagSlug
          problemsSolved
        }
        advanced {
          tagName
          tagSlug
          problemsSolved
        }
      }
    }
  }
`;
var DAILY_CHALLENGE_QUERY = `
  query questionOfToday {
    activeDailyCodingChallengeQuestion {
      date
      link
      question {
        questionId
        questionFrontendId
        title
        titleSlug
        difficulty
        isPaidOnly
        acRate
        topicTags {
          name
          slug
        }
        status
      }
    }
  }
`;
var SUBMISSION_LIST_QUERY = `
  query submissionList($questionSlug: String!, $limit: Int, $offset: Int) {
    questionSubmissionList(
      questionSlug: $questionSlug
      limit: $limit
      offset: $offset
    ) {
      submissions {
        id
        statusDisplay
        lang
        runtime
        timestamp
        memory
      }
    }
  }
`;
var RANDOM_PROBLEM_QUERY = `
  query randomQuestion($categorySlug: String, $filters: QuestionListFilterInput) {
    randomQuestion(categorySlug: $categorySlug, filters: $filters) {
      titleSlug
    }
  }
`;
var SUBMISSION_DETAILS_QUERY = `
  query submissionDetails($submissionId: Int!) {
    submissionDetails(submissionId: $submissionId) {
      code
      runtime
      runtimeDisplay
      runtimePercentile
      memory
      memoryDisplay
      memoryPercentile
      statusDisplay
      lang {
        name
      }
    }
  }
`;
var CONTEST_LIST_QUERY = `
  query allContests {
    allContests {
      title
      titleSlug
      startTime
      duration
      originStartTime
      isVirtual
      containsPremium
    }
  }
`;
var CONTEST_DETAIL_QUERY = `
  query contest($titleSlug: String!) {
    contest(titleSlug: $titleSlug) {
      title
      titleSlug
      startTime
      duration
      originStartTime
      isVirtual
      containsPremium
      description
      questions {
        questionId
        title
        titleSlug
      }
    }
  }
`;
var GLOBAL_QUERY_PACK = {
  PROBLEM_LIST_QUERY,
  PROBLEM_DETAIL_QUERY,
  USER_STATUS_QUERY,
  USER_PROFILE_QUERY,
  SKILL_STATS_QUERY,
  DAILY_CHALLENGE_QUERY,
  SUBMISSION_LIST_QUERY,
  RANDOM_PROBLEM_QUERY,
  SUBMISSION_DETAILS_QUERY,
  CONTEST_LIST_QUERY,
  CONTEST_DETAIL_QUERY
};

// src/api/queries.cn.ts
var PROBLEM_LIST_QUERY_CN = `
  query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
    problemsetQuestionList(
      categorySlug: $categorySlug
      limit: $limit
      skip: $skip
      filters: $filters
    ) {
      total
      questions {
        frontendQuestionId
        title
        titleCn
        titleSlug
        difficulty
        paidOnly
        acRate
        status
        topicTags {
          name
          nameTranslated
          id
          slug
        }
      }
    }
  }
`;
var PROBLEM_DETAIL_QUERY_CN = `
  query questionData($titleSlug: String!) {
    question(titleSlug: $titleSlug) {
      questionId
      questionFrontendId
      boundTopicId
      title
      titleSlug
      content
      translatedTitle
      translatedContent
      difficulty
      isPaidOnly
      acRate
      likes
      dislikes
      isLiked
      similarQuestions
      exampleTestcases
      exampleTestcaseList
      contributors {
        username
        profileUrl
        avatarUrl
      }
      status
      topicTags {
        name
        slug
        translatedName
      }
      companyTagStats
      codeSnippets {
        lang
        langSlug
        code
      }
      stats
      hints
      solution {
        id
        canSeeDetail
      }
      sampleTestCase
      metaData
      judgerAvailable
      judgeType
      mysqlSchemas
      enableRunCode
      enableTestMode
      libraryUrl
      note
    }
  }
`;
var DAILY_CHALLENGE_QUERY_CN = `
  query questionOfToday {
    todayRecord {
      date
      userStatus
      question {
        questionId
        frontendQuestionId: questionFrontendId
        difficulty
        title
        titleCn: translatedTitle
        titleSlug
        paidOnly: isPaidOnly
        acRate
        status
        topicTags {
          name
          nameTranslated: translatedName
          id
        }
      }
      lastSubmission {
        id
      }
    }
  }
`;
var USER_PROFILE_QUERY_CN = `
  query getUserProfile($username: String!) {
    userProfileUserQuestionProgress(userSlug: $username) {
      numAcceptedQuestions {
        count
        difficulty
      }
    }
    userProfilePublicProfile(userSlug: $username) {
      siteRanking
      profile {
        userSlug
        realName
      }
    }
  }
`;
var SKILL_STATS_QUERY_CN = `
  query skillStats($username: String!) {
    userProfilePublicProfile(userSlug: $username) {
      profile {
        skillSet {
          topicAreaScores {
            score
            topicArea {
              name
              slug
            }
          }
        }
      }
    }
  }
`;
var CONTEST_LIST_QUERY_CN = `
  query contestHistory($pageNum: Int!, $pageSize: Int) {
    contestHistory(pageNum: $pageNum, pageSize: $pageSize) {
      totalNum
      contests {
        containsPremium
        title
        titleSlug
        description
        startTime
        duration
        originStartTime
        isVirtual
      }
    }
  }
`;
var CONTEST_DETAIL_QUERY_CN = CONTEST_DETAIL_QUERY;
var SUBMISSION_LIST_QUERY_CN = `
  query submissionList($questionSlug: String!, $limit: Int, $offset: Int) {
    questionSubmissionList: submissionList(
      questionSlug: $questionSlug
      limit: $limit
      offset: $offset
    ) {
      submissions {
        id
        statusDisplay
        lang
        runtime
        timestamp
        memory
      }
    }
  }
`;
var SUBMISSION_DETAILS_QUERY_CN = `
  query submissionDetails($submissionId: ID!) {
    submissionDetails: submissionDetail(submissionId: $submissionId) {
      code
      runtime
      runtimePercentile
      memory
      memoryPercentile
      statusDisplay
      lang
    }
  }
`;
var CN_QUERY_PACK = {
  PROBLEM_LIST_QUERY: PROBLEM_LIST_QUERY_CN,
  PROBLEM_DETAIL_QUERY: PROBLEM_DETAIL_QUERY_CN,
  USER_STATUS_QUERY: `query { userStatus { isSignedIn username userSlug } }`,
  USER_PROFILE_QUERY: USER_PROFILE_QUERY_CN,
  SKILL_STATS_QUERY: SKILL_STATS_QUERY_CN,
  DAILY_CHALLENGE_QUERY: DAILY_CHALLENGE_QUERY_CN,
  SUBMISSION_LIST_QUERY: SUBMISSION_LIST_QUERY_CN,
  RANDOM_PROBLEM_QUERY,
  SUBMISSION_DETAILS_QUERY: SUBMISSION_DETAILS_QUERY_CN,
  CONTEST_LIST_QUERY: CONTEST_LIST_QUERY_CN,
  CONTEST_DETAIL_QUERY: CONTEST_DETAIL_QUERY_CN
};

// src/api/query-resolver.ts
function getQueryPack(site) {
  if (site === "leetcode.cn") {
    return CN_QUERY_PACK;
  }
  return GLOBAL_QUERY_PACK;
}

// src/api/adapters/cn.ts
function toTitleCaseDifficulty(difficulty) {
  const value = (difficulty ?? "").toLowerCase();
  if (value === "easy") return "Easy";
  if (value === "hard") return "Hard";
  return "Medium";
}
function toStatus(status) {
  const value = (status ?? "").toLowerCase();
  if (value === "ac") return "ac";
  if (value === "notac" || value === "tried") return "notac";
  if (value === "not_started") return null;
  return null;
}
function toSlug(text) {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function toProblem(question) {
  const title = question.titleCn || question.title || "Unknown Problem";
  const titleSlug = question.titleSlug || toSlug(title);
  const tags = (question.topicTags ?? []).map((tag) => {
    const tagName = tag.nameTranslated || tag.name || "Tag";
    return {
      name: tagName,
      slug: tag.id !== void 0 && tag.id !== null ? String(tag.id) : toSlug(tagName)
    };
  });
  return {
    questionId: String(question.questionId ?? ""),
    questionFrontendId: String(question.frontendQuestionId ?? question.questionFrontendId ?? ""),
    title,
    titleSlug,
    difficulty: toTitleCaseDifficulty(question.difficulty),
    isPaidOnly: Boolean(question.paidOnly ?? question.isPaidOnly),
    acRate: Number(question.acRate ?? 0),
    topicTags: tags,
    status: toStatus(question.status)
  };
}
function toProblemFromListEntry(question) {
  const title = question.titleCn || question.title || "Unknown Problem";
  const titleSlug = question.titleSlug || toSlug(title);
  const tags = (question.topicTags ?? []).map((tag) => {
    const tagName = tag.nameTranslated || tag.name || "Tag";
    return {
      name: tagName,
      slug: tag.slug || (tag.id !== void 0 && tag.id !== null ? String(tag.id) : toSlug(tagName))
    };
  });
  return {
    questionId: String(question.frontendQuestionId ?? ""),
    questionFrontendId: String(question.frontendQuestionId ?? ""),
    title,
    titleSlug,
    difficulty: toTitleCaseDifficulty(question.difficulty),
    isPaidOnly: Boolean(question.paidOnly),
    acRate: Number(question.acRate ?? 0),
    topicTags: tags,
    status: toStatus(question.status)
  };
}
function normalizeCnDailyChallenge(input) {
  const record = input.todayRecord?.[0];
  if (!record || !record.question) {
    throw new Error("No daily challenge found for leetcode.cn");
  }
  const problem = toProblem(record.question);
  return {
    date: record.date ?? (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
    link: record.link || `/problems/${problem.titleSlug}/`,
    question: problem
  };
}
function normalizeCnProblemList(input) {
  return {
    total: input.problemsetQuestionList.total,
    problems: input.problemsetQuestionList.questions.map(
      (question) => toProblemFromListEntry(question)
    )
  };
}
function normalizeCnProblemDetail(input) {
  const question = input.question;
  const title = question.translatedTitle || question.title || "Unknown Problem";
  const titleSlug = question.titleSlug || toSlug(title);
  const topicTags = (question.topicTags ?? []).map((tag) => ({
    name: tag.translatedName || tag.name || "Tag",
    slug: tag.slug || toSlug(tag.translatedName || tag.name || "tag")
  }));
  return {
    questionId: String(question.questionId ?? ""),
    questionFrontendId: String(question.questionFrontendId ?? ""),
    title,
    titleSlug,
    content: question.translatedContent ?? null,
    difficulty: toTitleCaseDifficulty(question.difficulty),
    isPaidOnly: Boolean(question.isPaidOnly),
    acRate: Number(question.acRate ?? 0),
    topicTags,
    codeSnippets: question.codeSnippets ?? null,
    sampleTestCase: question.sampleTestCase ?? "",
    exampleTestcaseList: question.exampleTestcaseList ?? void 0,
    metaData: question.metaData ?? void 0,
    exampleTestcases: question.exampleTestcases ?? "",
    hints: question.hints ?? [],
    companyTags: null,
    stats: question.stats ?? "{}",
    status: toStatus(question.status)
  };
}
function normalizeCnUserProfile(username, input) {
  const publicProfile = input.userProfilePublicProfile?.profile;
  const accepted = input.userProfileUserQuestionProgress?.numAcceptedQuestions ?? [];
  const countMap = /* @__PURE__ */ new Map([
    ["All", 0],
    ["Easy", 0],
    ["Medium", 0],
    ["Hard", 0]
  ]);
  for (const item of accepted) {
    const key = toTitleCaseDifficulty(item.difficulty);
    const value = Number(item.count ?? 0);
    countMap.set(key, value);
  }
  const all = (countMap.get("Easy") ?? 0) + (countMap.get("Medium") ?? 0) + (countMap.get("Hard") ?? 0);
  countMap.set("All", Math.max(countMap.get("All") ?? 0, all));
  return {
    username: publicProfile?.userSlug || username,
    realName: publicProfile?.realName || username,
    ranking: Number(input.userProfilePublicProfile?.siteRanking ?? 0),
    acSubmissionNum: [
      { difficulty: "All", count: countMap.get("All") ?? 0 },
      { difficulty: "Easy", count: countMap.get("Easy") ?? 0 },
      { difficulty: "Medium", count: countMap.get("Medium") ?? 0 },
      { difficulty: "Hard", count: countMap.get("Hard") ?? 0 }
    ],
    streak: 0,
    totalActiveDays: 0,
    submissionCalendar: ""
  };
}
function normalizeCnSkillStats(input) {
  const topicScores = input.userProfilePublicProfile?.profile?.skillSet?.topicAreaScores ?? [];
  const ordered = topicScores.map((entry) => ({
    tagName: entry.topicArea?.name || "Topic",
    tagSlug: entry.topicArea?.slug || toSlug(entry.topicArea?.name || "topic"),
    problemsSolved: Math.max(0, Math.round(Number(entry.score ?? 0)))
  })).sort((a, b) => b.problemsSolved - a.problemsSolved);
  if (ordered.length === 0) {
    return { fundamental: [], intermediate: [], advanced: [] };
  }
  const third = Math.max(1, Math.ceil(ordered.length / 3));
  const advanced = ordered.slice(0, third);
  const intermediate = ordered.slice(third, third * 2);
  const fundamental = ordered.slice(third * 2);
  return { fundamental, intermediate, advanced };
}

// src/api/client.ts
var BASE_URLS = {
  "leetcode.com": "https://leetcode.com",
  "leetcode.cn": "https://leetcode.cn"
};
var OPERATION_LABEL = {
  USER_STATUS: "user status",
  PROBLEM_LIST: "problem list",
  PROBLEM_DETAIL: "problem detail",
  DAILY_CHALLENGE: "daily challenge",
  RANDOM_PROBLEM: "random problem",
  USER_PROFILE: "user profile",
  SKILL_STATS: "skill stats",
  SUBMISSION_LIST: "submission list",
  SUBMISSION_DETAILS: "submission details",
  CONTEST_LIST: "contest list",
  CONTEST_DETAIL: "contest detail"
};
function isSchemaMismatchError(message) {
  return /(cannot query field|unknown argument|unknown type|did you mean|validation error)/i.test(
    message
  );
}
var LeetCodeClient = class {
  client;
  credentials = null;
  site;
  queries;
  constructor(site = "leetcode.com", transport) {
    this.site = site;
    this.queries = getQueryPack(site);
    this.client = transport ?? this.createHttpClient(site);
  }
  createHttpClient(site) {
    const baseUrl = BASE_URLS[site];
    return got.extend({
      prefixUrl: baseUrl,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Origin: baseUrl,
        Referer: `${baseUrl}/`
      },
      timeout: { request: 3e4 },
      retry: { limit: 2 }
    });
  }
  setSite(site) {
    if (site === this.site) {
      return;
    }
    this.site = site;
    this.queries = getQueryPack(site);
    this.client = this.createHttpClient(site);
    if (this.credentials) {
      this.setCredentials(this.credentials);
    }
  }
  getSite() {
    return this.site;
  }
  setCredentials(credentials) {
    this.credentials = credentials;
    this.client = this.client.extend({
      headers: {
        Cookie: `LEETCODE_SESSION=${credentials.session}; csrftoken=${credentials.csrfToken}`,
        "X-CSRFToken": credentials.csrfToken
      }
    });
  }
  getCredentials() {
    return this.credentials;
  }
  resolveGraphQLEndpoints() {
    if (this.site === "leetcode.cn") {
      return ["graphql/"];
    }
    return ["graphql"];
  }
  formatGraphQLError(operation, message) {
    const label = OPERATION_LABEL[operation];
    if (this.site === "leetcode.cn") {
      if (isSchemaMismatchError(message)) {
        return `LeetCode CN schema mismatch for ${label}: ${message}. If you intended Global LeetCode, run: leetcode config --site leetcode.com`;
      }
      return `LeetCode CN API error for ${label}: ${message}`;
    }
    return `GraphQL Error (${label}): ${message}`;
  }
  async graphql(operation, query, variables = {}) {
    const endpoints = this.resolveGraphQLEndpoints();
    let lastError = null;
    for (const endpoint of endpoints) {
      try {
        const response = await this.client.post(endpoint, {
          json: { query, variables }
        }).json();
        if (response.errors?.length) {
          const message = response.errors.map((entry) => entry.message).join("; ");
          lastError = new Error(this.formatGraphQLError(operation, message));
          continue;
        }
        if (response.data === void 0) {
          lastError = new Error(this.formatGraphQLError(operation, "Empty GraphQL response data"));
          continue;
        }
        return response.data;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new Error(`Failed to fetch ${OPERATION_LABEL[operation]}`);
  }
  async checkAuth() {
    const data = await this.graphql("USER_STATUS", this.queries.USER_STATUS_QUERY);
    const validated = UserStatusSchema.parse(data.userStatus);
    return validated;
  }
  async getProblems(filters = {}) {
    const variables = {
      categorySlug: "",
      limit: filters.limit ?? 50,
      skip: filters.skip ?? 0,
      filters: {}
    };
    if (filters.difficulty) {
      variables.filters.difficulty = filters.difficulty;
    }
    if (filters.status) {
      variables.filters.status = filters.status;
    }
    if (filters.tags?.length) {
      variables.filters.tags = filters.tags;
    }
    if (filters.searchKeywords) {
      variables.filters.searchKeywords = filters.searchKeywords;
    }
    if (this.site === "leetcode.cn") {
      const data2 = await this.graphql(
        "PROBLEM_LIST",
        this.queries.PROBLEM_LIST_QUERY,
        variables
      );
      const validated = CnProblemListSchema.parse(data2);
      return normalizeCnProblemList(validated);
    }
    const data = await this.graphql("PROBLEM_LIST", this.queries.PROBLEM_LIST_QUERY, variables);
    const validatedProblems = z3.array(ProblemSchema).parse(data.problemsetQuestionList.questions);
    return {
      total: data.problemsetQuestionList.total,
      problems: validatedProblems
    };
  }
  async getProblem(titleSlug) {
    if (this.site === "leetcode.cn") {
      const data2 = await this.graphql(
        "PROBLEM_DETAIL",
        this.queries.PROBLEM_DETAIL_QUERY,
        {
          titleSlug
        }
      );
      const validated2 = CnProblemDetailSchema.parse(data2);
      return normalizeCnProblemDetail(validated2);
    }
    const data = await this.graphql(
      "PROBLEM_DETAIL",
      this.queries.PROBLEM_DETAIL_QUERY,
      {
        titleSlug
      }
    );
    const validated = ProblemDetailSchema.parse(data.question);
    return validated;
  }
  async getProblemById(id) {
    if (this.site === "leetcode.cn") {
      const limit = 50;
      let skip = 0;
      let total = 0;
      let problem2;
      do {
        const result = await this.getProblems({ searchKeywords: id, limit, skip });
        total = result.total;
        problem2 = result.problems.find((p) => p.questionFrontendId === id);
        skip += limit;
      } while (!problem2 && skip < total);
      if (!problem2) {
        throw new Error(`Problem #${id} not found`);
      }
      return this.getProblem(problem2.titleSlug);
    }
    const { problems } = await this.getProblems({ searchKeywords: id, limit: 10 });
    const problem = problems.find((p) => p.questionFrontendId === id);
    if (!problem) {
      throw new Error(`Problem #${id} not found`);
    }
    return this.getProblem(problem.titleSlug);
  }
  async getDailyChallenge() {
    if (this.site === "leetcode.cn") {
      const data2 = await this.graphql(
        "DAILY_CHALLENGE",
        this.queries.DAILY_CHALLENGE_QUERY
      );
      const validated2 = CnDailyChallengeSchema.parse(data2);
      return normalizeCnDailyChallenge(validated2);
    }
    const data = await this.graphql("DAILY_CHALLENGE", this.queries.DAILY_CHALLENGE_QUERY);
    const validated = DailyChallengeSchema.parse(data.activeDailyCodingChallengeQuestion);
    return validated;
  }
  async getContests() {
    if (this.site === "leetcode.cn") {
      const pageSize = 100;
      const contests = [];
      let pageNum = 1;
      let totalNum = 0;
      do {
        const data2 = await this.graphql("CONTEST_LIST", this.queries.CONTEST_LIST_QUERY, {
          pageNum,
          pageSize
        });
        const validated2 = CnContestHistorySchema.parse(data2);
        const page = validated2.contestHistory.contests;
        if (pageNum === 1) {
          totalNum = validated2.contestHistory.totalNum;
        }
        if (totalNum > contests.length && page.length === 0) {
          throw new Error("LeetCode CN contest history returned an incomplete page");
        }
        contests.push(
          ...page.map((contest) => ({
            title: contest.title,
            titleSlug: contest.titleSlug,
            startTime: contest.startTime,
            duration: contest.duration,
            originStartTime: contest.originStartTime,
            isVirtual: contest.isVirtual,
            containsPremium: contest.containsPremium
          }))
        );
        pageNum += 1;
      } while (contests.length < totalNum);
      return contests;
    }
    const data = await this.graphql("CONTEST_LIST", this.queries.CONTEST_LIST_QUERY);
    const validated = ContestListSchema.parse(data);
    return validated.allContests;
  }
  async getContest(titleSlug) {
    const data = await this.graphql("CONTEST_DETAIL", this.queries.CONTEST_DETAIL_QUERY, {
      titleSlug
    });
    const validated = ContestDetailResponseSchema.parse(data);
    if (!validated.contest) {
      throw new Error(`Contest "${titleSlug}" not found`);
    }
    return validated.contest;
  }
  async getRandomProblem(filters = {}) {
    const variables = {
      categorySlug: "",
      filters: {}
    };
    if (filters.difficulty) {
      variables.filters.difficulty = filters.difficulty;
    }
    if (filters.tags?.length) {
      variables.filters.tags = filters.tags;
    }
    const data = await this.graphql("RANDOM_PROBLEM", this.queries.RANDOM_PROBLEM_QUERY, variables);
    const validated = z3.object({ titleSlug: z3.string() }).parse(data.randomQuestion);
    return validated.titleSlug;
  }
  async getUserProfile(username) {
    if (this.site === "leetcode.cn") {
      const data2 = await this.graphql("USER_PROFILE", this.queries.USER_PROFILE_QUERY, {
        username
      });
      const validated2 = CnUserProfileSchema.parse(data2);
      return normalizeCnUserProfile(username, validated2);
    }
    const data = await this.graphql("USER_PROFILE", this.queries.USER_PROFILE_QUERY, { username });
    const user = data.matchedUser;
    const validated = UserProfileSchema.parse(user);
    return {
      username: validated.username,
      realName: validated.profile.realName,
      ranking: validated.profile.ranking,
      acSubmissionNum: validated.submitStatsGlobal.acSubmissionNum,
      streak: validated.userCalendar.streak,
      totalActiveDays: validated.userCalendar.totalActiveDays,
      submissionCalendar: user.userCalendar.submissionCalendar
    };
  }
  async getSkillStats(username) {
    if (this.site === "leetcode.cn") {
      const data2 = await this.graphql("SKILL_STATS", this.queries.SKILL_STATS_QUERY, {
        username
      });
      const validated = CnSkillStatsSchema.parse(data2);
      return normalizeCnSkillStats(validated);
    }
    const data = await this.graphql("SKILL_STATS", this.queries.SKILL_STATS_QUERY, { username });
    return data.matchedUser.tagProblemCounts;
  }
  async getSubmissionList(slug, limit = 20, offset = 0) {
    const data = await this.graphql("SUBMISSION_LIST", this.queries.SUBMISSION_LIST_QUERY, {
      questionSlug: slug,
      limit,
      offset
    });
    const validated = z3.array(SubmissionSchema).parse(data.questionSubmissionList.submissions);
    return validated;
  }
  async getSubmissionDetails(submissionId) {
    const data = await this.graphql("SUBMISSION_DETAILS", this.queries.SUBMISSION_DETAILS_QUERY, { submissionId });
    if (data.submissionDetails == null) {
      throw new Error(
        `Submission ${submissionId} is unavailable. Check your login and access to this submission.`
      );
    }
    const schema = this.site === "leetcode.cn" ? CnSubmissionDetailsSchema : SubmissionDetailsSchema;
    const validated = schema.parse(data.submissionDetails);
    return validated;
  }
  async startRun(request, options2) {
    return startJob(this.client, "run", request, options2);
  }
  async startSubmit(request, options2) {
    return startJob(this.client, "submit", request, options2);
  }
  async checkJob(job, options2) {
    return checkJob(this.client, job, options2);
  }
  async testSolution(titleSlug, code, lang, testcases, questionId) {
    const job = await this.startRun({ titleSlug, code, lang, testcases, questionId });
    return this.pollSubmission(job, TestResultSchema);
  }
  async submitSolution(titleSlug, code, lang, questionId) {
    const job = await this.startSubmit({ titleSlug, code, lang, questionId });
    return this.pollSubmission(job, SubmissionResultSchema);
  }
  async pollSubmission(job, schema) {
    const signal = AbortSignal.timeout(3e4);
    try {
      for (let attempt = 0; attempt < 12; attempt++) {
        const status = await this.checkJob(job, { signal });
        if (status.state === "complete") return schema.parse(status.result);
        await delay(Math.min(500 * 2 ** attempt, 3e3), void 0, { signal });
      }
    } catch (error) {
      if (!signal.aborted) throw error;
    }
    throw new ClientError(
      "network",
      `Stopped waiting for task ${job.id}; resume with checkJob, do not resend.`
    );
  }
};
var leetcodeClient = new LeetCodeClient();
export {
  ClientError,
  LeetCodeClient,
  clientError
};
