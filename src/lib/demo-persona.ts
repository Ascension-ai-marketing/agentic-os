/** Fictional examples only. No generated identity is an authenticated account. */
const people = [
  [
    "Alex Morgan",
    "Freelance designer",
    "Northlight Studio",
    "Brand identities and simple websites for independent businesses",
    "Finish the café website",
    "Sign two retainer clients",
    "Build a steady three-day client week",
  ],
  [
    "Jamie Taylor",
    "Marketing consultant",
    "Small Hours Marketing",
    "Practical marketing plans for local service businesses",
    "Send the spring campaign proposal",
    "Launch a monthly client workshop",
    "Reach £6,000 in monthly client work",
  ],
  [
    "Priya Shah",
    "Online shop owner",
    "Sunday Supply",
    "Thoughtful stationery and desk accessories",
    "Photograph the new notebook range",
    "Launch the autumn collection",
    "Grow repeat orders by 15%",
  ],
  [
    "Sam Reed",
    "Project manager",
    "Reed Projects",
    "Helping small teams deliver digital projects on time",
    "Finish the client handover",
    "Create a reusable project checklist",
    "Take on one new long-term client",
  ],
  [
    "Riley Chen",
    "Fitness coach",
    "Everyday Movement",
    "Realistic strength and mobility coaching for busy people",
    "Plan next week's coaching sessions",
    "Run a beginners' strength workshop",
    "Welcome ten regular coaching clients",
  ],
  [
    "Jordan Ellis",
    "Independent photographer",
    "Ellis Photography",
    "Natural portraits and product photography for small brands",
    "Deliver the studio portrait edits",
    "Refresh the portfolio website",
    "Book six brand shoots",
  ],
] as const;

export function generateDemoPersona(random = Math.random, previousName = "") {
  let index = Math.min(people.length - 1, Math.max(0, Math.floor(random() * people.length)));
  if (people[index][0] === previousName) index = (index + 1) % people.length;
  const [name, role, businessName, whatYouDo, week, month, quarter] = people[index];
  return {
    profile: {
      name,
      role,
      about: `I'm ${name}, a ${role.toLowerCase()}. I want a clear view of my priorities, enough time for focused work and a practical plan for each week.`,
      responsePreferences:
        "Be clear and practical. Start with the next useful action. Ask before making commitments.",
      timeZone: "Europe/London",
      currency: "GBP",
      avatar: "",
      hourlyRate: 60 + index * 5,
      publicProfiles: [],
      onboardingFlowVersion: 2 as const,
      onboardingStep: 0,
    },
    business: {
      preferredName: name,
      businessName,
      whatYouDo,
      whoYouHelp: "Independent businesses and busy professionals",
      personalPriorities:
        "Protect focused mornings, keep evenings free and exercise three times a week",
      longTermDirection: "A sustainable independent business with time for life outside work",
      quarterGoal: quarter,
    },
    goals: { week, month, quarter },
  };
}
