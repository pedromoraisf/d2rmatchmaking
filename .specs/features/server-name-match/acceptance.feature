# Acceptance scenarios for server-name-match (ADR 023). English Gherkin. Executed as-is by tests/acceptance (playwright-bdd).

Feature: A name read on screen stands for a known character, or for nothing
  Players and their agents read character names off the screen and the chat, and the screen misreads letters. The API
  matches a read name to the characters it knows and keeps only the match: never the name that was read.

  Background:
    Given Alice and Bob are in a room, with their agents paired

  @SNM-01 @FR-27 @api
  Scenario Outline: A joined message must carry a name D2R could have
    When Bob's agent reports "<name>" as a player who joined
    Then the API answers "<status>"

    Examples:
      | name                | status |
      | Sorc                | 202    |
      | Hammer_Smith        | 202    |
      | S                   | 400    |
      | Sorc Sorc           | 400    |
      | Sorc2               | 400    |
      | ThisNameIsTooLongXX | 400    |

  @SNM-03 @FR-27 @api
  Scenario: A member who joined is matched and the match is kept
    When Bob's agent reports "Sorc" as a player who joined
    Then the API answers "202" and the sighting is kept

  @SNM-03 @FR-27 @api
  Scenario: A name that is nobody in the room is not kept
    When Bob's agent reports "Zzyzx" as a player who joined
    Then the API answers "202" and the sighting is not kept

  @SNM-03 @SNM-02 @FR-27 @api
  Scenario Outline: A letter the screen misread still finds the member
    When Bob's agent reports "<read>" as a player who left
    Then the API answers "202" and the sighting is <kept>

    Examples:
      | read   | kept         |
      | Sorc   | kept         |
      | sorc   | kept         |
      | Sgrc   | kept         |
      | Sbrc   | kept         |
      | Serc   | kept         |
      | S0rc   | kept         |
      | Sorg   | not kept     |
      | Hamner | not kept     |

  @SNM-03 @FR-27 @api
  Scenario: The same sighting posted again is kept once
    Given Bob's agent reported "Sorc" as a player who joined
    When Bob's agent reports the same sighting again
    Then the API answers "202" and the sighting is not kept

  @SNM-04 @NFR-04 @api
  Scenario: Nothing the API answers or shows carries the name that was read
    When Bob's agent reports "Zzyzx" as a player who joined
    Then no answer of the API and no room view of Alice or Bob holds "Zzyzx"

  @SNM-05 @FR-27 @agent
  Scenario: The agent posts the joined message of a member
    Given Alice's agent holds the room and sees the chat fixture "chat-joined"
    When the chat shows that "Hammer" joined the game
    Then the API holds one joined sighting for Bob's character

  @SNM-05 @FR-27 @agent
  Scenario: The agent posts nothing when it holds no room
    Given Alice's agent has capture consent and no room
    When the chat shows that "Hammer" joined the game
    Then the agent sent no observation

  @SNM-06 @NFR-04 @agent
  Scenario: Only the observation's own keys leave the PC for a chat message
    Given Alice's agent holds the room and sees the chat fixture "chat-joined"
    When the chat shows that "Hammer" joined the game
    Then every chat observation Alice's agent sent holds only the keys of the observation contract
    And its value is the name and nothing else

  @SNM-07 @FR-02 @api
  Scenario: A character whose name the screen misread is not added twice
    Given Alice's agent posted her sorceress "Sorc" at level 85
    When Alice's agent posts a sorceress "Sgrc" at level 86
    Then Alice's character list shows one character "Sorc" at level 86

  @SNM-07 @FR-02 @api
  Scenario Outline: A card that is not that character is added as a new one
    Given Alice's agent posted her sorceress "Sorc" at level 85
    When Alice's agent posts a <card>
    Then Alice's character list shows two characters

    Examples:
      | card                       |
      | paladin "Sgrc" at level 86 |
      | hardcore sorceress "Sgrc" at level 86 |
      | sorceress "Sgrc" at level 80 |

  @SNM-08 @FR-27 @api
  Scenario: A sighting changes nothing about the room
    When Bob's agent reports "Sorc" as a player who joined
    Then the room is still awaiting the host

  @SNM-08 @FR-27 @api
  Scenario: An agent that is not in the room cannot report in it
    Given Carol has a paired agent
    When Carol's agent reports "Sorc" as a player who joined in Alice's room
    Then the API answers "403"
